"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { validateNickname } from "@/lib/nickname";
import { usernameToAuthEmail, validateUsername } from "@/lib/username";

const PASSWORD_MIN = 8;
const SIGNUP_HOURLY_LIMIT = 5; // 같은 IP에서 1시간 내 허용하는 최대 가입 시도 횟수

async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip");
}

async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocol =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

// 캡차(Turnstile)를 뚫고 온 요청까지 대비한 2차 방어선. IP를 알 수 없는 환경(로컬 등)에서는 건너뛴다.
async function checkSignupRateLimit(ip: string | null): Promise<string | null> {
  if (!ip) return null;

  const admin = createAdminClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // 이 IP의 오래된 기록은 지워서 테이블이 무한히 커지지 않게 한다.
  await admin.from("signup_attempts").delete().eq("ip_address", ip).lt("created_at", oneHourAgo);

  const { count } = await admin
    .from("signup_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip_address", ip)
    .gte("created_at", oneHourAgo);

  if ((count ?? 0) >= SIGNUP_HOURLY_LIMIT) {
    return "짧은 시간 동안 너무 많이 시도했어요. 잠시 후 다시 시도해주세요.";
  }

  await admin.from("signup_attempts").insert({ ip_address: ip });
  return null;
}

export type SignupResult =
  | { success: true; redirectTo: string }
  | {
      success: false;
      field: "username" | "nickname" | "password" | "passwordConfirm" | "general";
      error: string;
    };

// 회원가입 폼은 실패 시 필드별로 빨간 에러 문구를 보여주고 입력값은 그대로 유지해야
// 해서, 리다이렉트로 결과를 전달하던 다른 폼 액션들과 달리 결과를 그대로 반환한다
// (클라이언트가 useTransition으로 직접 호출).
export async function signUpUser(input: {
  username: string;
  nickname: string;
  password: string;
  passwordConfirm: string;
  next: string;
  captchaToken: string;
}): Promise<SignupResult> {
  const next = sanitizeNextPath(input.next);

  const usernameResult = validateUsername(input.username);
  if (usernameResult.error !== null) {
    return { success: false, field: "username", error: usernameResult.error };
  }
  const username = usernameResult.username;

  const nicknameResult = validateNickname(input.nickname);
  if (nicknameResult.error !== null) {
    return { success: false, field: "nickname", error: nicknameResult.error };
  }
  const nickname = nicknameResult.nickname;

  if (input.password.length < PASSWORD_MIN) {
    return {
      success: false,
      field: "password",
      error: `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요`,
    };
  }

  if (input.password !== input.passwordConfirm) {
    return { success: false, field: "passwordConfirm", error: "비밀번호가 일치하지 않아요" };
  }

  // 사이트 키가 설정된 경우에만 캡차를 요구한다 (로컬 개발 중 Turnstile 미설정 시에는 건너뜀).
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !input.captchaToken) {
    return { success: false, field: "general", error: "캡차 인증을 완료해주세요" };
  }

  const rateLimitError = await checkSignupRateLimit(await getClientIp());
  if (rateLimitError) {
    return { success: false, field: "general", error: rateLimitError };
  }

  const supabase = await createClient();

  // 최종 방어선은 profiles의 유니크 인덱스지만, 계정을 만들고 나서야 걸리면 되돌리기
  // 번거로우니 계정 생성 전에 한 번 더 확인해서 흔한 경우를 미리 걸러낸다.
  const { data: taken } = await supabase.rpc("is_nickname_taken", {
    check_nickname: nickname,
    exclude_user_id: null,
  });
  if (taken) {
    return { success: false, field: "nickname", error: "이미 사용 중인 닉네임이에요." };
  }

  // Supabase Auth는 이메일/전화번호 식별자만 지원해서, 아이디를 가짜 이메일로 감싸 저장한다.
  const { data, error } = await supabase.auth.signUp({
    email: usernameToAuthEmail(username),
    password: input.password,
    options: {
      data: { nickname, username },
      ...(input.captchaToken ? { captchaToken: input.captchaToken } : {}),
    },
  });

  if (error) {
    // Supabase는 "이미 가입된 이메일" 상황을 이런 문구로 알려준다. 그 외의 실패는
    // 원인이 다양해서(캡차 검증 실패 등) 아이디 탓으로 잘못 안내하지 않는다.
    const isDuplicate = /already registered|already exists|already in use/i.test(
      error.message,
    );
    return {
      success: false,
      field: isDuplicate ? "username" : "general",
      error: isDuplicate
        ? "이미 사용 중인 아이디예요."
        : "가입에 실패했어요. 잠시 후 다시 시도해주세요.",
    };
  }

  if (!data.user) {
    return { success: false, field: "general", error: "가입에 실패했어요." };
  }

  // 닉네임을 profiles에 예약해 둔다. 사전 확인 이후 동시에 같은 닉네임으로 가입한
  // 경합 상황이면 여기서 유니크 인덱스에 걸리므로, 방금 만든 계정을 롤백해 고아 계정이
  // 남지 않게 한다.
  const admin = createAdminClient();
  const { error: profileError } = await admin
    .from("profiles")
    .insert({ user_id: data.user.id, nickname });

  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { success: false, field: "nickname", error: "이미 사용 중인 닉네임이에요." };
  }

  if (!data.session) {
    return {
      success: true,
      redirectTo: `/login?next=${encodeURIComponent(next)}&message=${encodeURIComponent("가입이 완료됐어요. 로그인해주세요")}`,
    };
  }

  return { success: true, redirectTo: next };
}

// 회원가입 폼의 "중복확인" 버튼에서 직접(폼 제출이 아니라 클라이언트 코드에서) 호출한다.
export async function checkUsernameAvailable(
  rawUsername: string,
): Promise<{ available?: boolean; error?: string }> {
  const usernameResult = validateUsername(rawUsername);
  if (usernameResult.error !== null) return { error: usernameResult.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_username_taken", {
    check_username: usernameResult.username,
  });

  if (error) return { error: "중복 확인에 실패했어요." };
  return { available: !data };
}

export async function signInWithGoogle(formData: FormData) {
  const origin = await getOrigin();
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error || !data.url) {
    redirect(
      `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent("구글 로그인을 시작할 수 없어요")}`,
    );
  }

  redirect(data.url);
}

export async function signInUser(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToAuthEmail(username),
    password,
  });

  if (error) {
    redirect(
      `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent("아이디/비밀번호를 확인해주세요")}`,
    );
  }

  redirect(next);
}

export async function signOutUser() {
  const supabase = await createClient();
  // scope: "local"은 Supabase Auth 서버로 세션 폐기 요청을 보내지 않고 이 브라우저의
  // 쿠키만 지운다. 이 사이트는 민감 정보를 다루지 않으므로, 그 왕복 시간만큼 로그아웃
  // 버튼이 굼떠 보이던 문제를 없애는 쪽을 택한다.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/");
}

function withQuery(path: string, key: string, value: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${encodeURIComponent(value)}`;
}

// 닉네임을 profiles(유니크 인덱스)와 user_metadata 양쪽에 반영한다. profiles는 "이
// 닉네임을 이미 누가 쓰고 있는지" 판별용 그림자 원장이고, user_metadata.nickname은
// 헤더/댓글/마이페이지 등 실제 화면에 뿌려주는 값의 원본이라 항상 같이 맞춰줘야 한다.
// upsert가 유니크 인덱스에 걸리면(23505) 사전에 checkNicknameAvailable로 확인했더라도
// 그 사이 다른 사람이 먼저 가져간 경합 상황이므로, 그 경우만 "중복" 에러로 안내한다.
async function persistNickname(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  nickname: string,
): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ user_id: userId, nickname }, { onConflict: "user_id" });

  if (profileError) {
    return {
      error:
        profileError.code === "23505"
          ? "이미 사용 중인 닉네임이에요."
          : "닉네임 변경에 실패했어요.",
    };
  }

  const { error } = await supabase.auth.updateUser({ data: { nickname } });
  if (error) return { error: "닉네임 변경에 실패했어요." };

  // 헤더 등 여러 서버 컴포넌트가 user_metadata.nickname을 읽어 렌더링하므로,
  // 이번 응답 이후 방문하는 페이지에 새 닉네임이 곧바로 반영되게 한다.
  revalidatePath("/", "layout");
  return {};
}

// formPath/successPath는 폼의 hidden input으로 넘어오는 값이라 사용자가 임의로 바꿔
// 보낼 수 있으니, 오픈 리다이렉트로 악용되지 않게 이 사이트 안쪽 경로로만 좁힌다.
// updateNickname(폼 제출 → 리다이렉트)은 구글 로그인 온보딩 화면에서 쓰고, 마이페이지
// "내 정보 수정"의 중복확인 버튼은 아래 setNickname(리다이렉트 없이 결과만 반환)을 쓴다.
export async function updateNickname(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const formPath = sanitizeNextPath(String(formData.get("formPath") ?? "/mypage/edit"));
  const successPath = sanitizeNextPath(String(formData.get("successPath") ?? formPath));

  // 폼은 로그인 상태에서만 노출되지만, 서버 액션은 URL로 직접 호출될 수도 있으니
  // 세션 자체를 여기서 다시 검증한다 (본인 계정 외에는 애초에 대상 id를 받지 않음).
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(formPath)}`);
  }

  const nicknameResult = validateNickname(String(formData.get("nickname") ?? ""));
  if (nicknameResult.error !== null) {
    redirect(withQuery(formPath, "error", nicknameResult.error));
  }

  const { error } = await persistNickname(supabase, user.id, nicknameResult.nickname);
  if (error) {
    redirect(withQuery(formPath, "error", error));
  }

  // 온보딩처럼 성공 후 완전히 다른 페이지로 넘어가는 경우엔 메시지 없이 그대로 보내고,
  // 같은 폼으로 되돌아오는 경우(마이페이지 수정)에만 성공 메시지를 붙인다.
  redirect(
    successPath === formPath
      ? withQuery(successPath, "message", "닉네임을 변경했어요.")
      : successPath,
  );
}

// 마이페이지의 "중복확인" 버튼에서 직접(폼 제출이 아니라 클라이언트 코드에서) 호출한다.
export async function checkNicknameAvailable(
  rawNickname: string,
): Promise<{ available?: boolean; error?: string }> {
  const nicknameResult = validateNickname(rawNickname);
  if (nicknameResult.error !== null) return { error: nicknameResult.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase.rpc("is_nickname_taken", {
    check_nickname: nicknameResult.nickname,
    exclude_user_id: user?.id ?? null,
  });

  if (error) return { error: "중복 확인에 실패했어요." };
  return { available: !data };
}

// "중복확인"이 통과하면 곧바로 저장까지 하는, 리다이렉트 없는 버전. 마이페이지 수정
// 화면처럼 별도 "저장" 버튼 없이 그 자리에서 바로 반영하는 UI에서 쓴다.
export async function setNickname(
  rawNickname: string,
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요해요." };

  const nicknameResult = validateNickname(rawNickname);
  if (nicknameResult.error !== null) return { error: nicknameResult.error };

  const { error } = await persistNickname(supabase, user.id, nicknameResult.nickname);
  if (error) return { error };
  return { success: true };
}

export async function updatePassword(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=%2Fmypage%2Fedit");
  }

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const newPasswordConfirm = String(formData.get("newPasswordConfirm") ?? "");

  if (newPassword.length < PASSWORD_MIN) {
    redirect(
      withQuery(
        "/mypage/edit",
        "error",
        `새 비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요`,
      ),
    );
  }

  if (newPassword !== newPasswordConfirm) {
    redirect(withQuery("/mypage/edit", "error", "새 비밀번호가 일치하지 않아요"));
  }

  if (!user.email) {
    redirect(withQuery("/mypage/edit", "error", "비밀번호를 변경할 수 없는 계정이에요"));
  }

  // updateUser는 이미 인증된 세션이면 현재 비밀번호 없이도 바꿔주지만, 방치된 로그인
  // 브라우저를 다른 사람이 그대로 쓰는 경우까지 대비해 현재 비밀번호를 한 번 더 확인한다.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (reauthError) {
    redirect(withQuery("/mypage/edit", "error", "현재 비밀번호가 일치하지 않아요"));
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    redirect(withQuery("/mypage/edit", "error", "비밀번호 변경에 실패했어요"));
  }

  redirect(withQuery("/mypage/edit", "message", "비밀번호를 변경했어요."));
}
