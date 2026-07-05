"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { validateNickname } from "@/lib/nickname";

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

export async function signUpUser(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  const captchaToken = String(formData.get("cf-turnstile-response") ?? "");
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const nextQuery = `next=${encodeURIComponent(next)}`;

  const { nickname, error: nicknameError } = validateNickname(
    String(formData.get("nickname") ?? ""),
  );
  if (nicknameError) {
    redirect(`/signup?${nextQuery}&error=${encodeURIComponent(nicknameError)}`);
  }

  if (password.length < PASSWORD_MIN) {
    redirect(
      `/signup?${nextQuery}&error=${encodeURIComponent(`비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요`)}`,
    );
  }

  if (password !== passwordConfirm) {
    redirect(`/signup?${nextQuery}&error=${encodeURIComponent("비밀번호가 일치하지 않아요")}`);
  }

  // 사이트 키가 설정된 경우에만 캡차를 요구한다 (로컬 개발 중 Turnstile 미설정 시에는 건너뜀).
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) {
    redirect(`/signup?${nextQuery}&error=${encodeURIComponent("캡차 인증을 완료해주세요")}`);
  }

  const rateLimitError = await checkSignupRateLimit(await getClientIp());
  if (rateLimitError) {
    redirect(`/signup?${nextQuery}&error=${encodeURIComponent(rateLimitError)}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { nickname },
      ...(captchaToken ? { captchaToken } : {}),
    },
  });

  if (error) {
    redirect(`/signup?${nextQuery}&error=${encodeURIComponent(error.message)}`);
  }

  if (!data.session) {
    redirect(
      `/login?${nextQuery}&message=${encodeURIComponent("가입 확인 이메일을 보냈어요. 메일함을 확인해주세요")}`,
    );
  }

  redirect(next);
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
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(
      `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent("이메일/비밀번호를 확인해주세요")}`,
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

export async function updateNickname(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 폼은 로그인 상태에서만 노출되지만, 서버 액션은 URL로 직접 호출될 수도 있으니
  // 세션 자체를 여기서 다시 검증한다 (본인 계정 외에는 애초에 대상 id를 받지 않음).
  if (!user) {
    redirect("/login?next=%2Fmypage%3Ftab%3Daccount");
  }

  const { nickname, error: nicknameError } = validateNickname(
    String(formData.get("nickname") ?? ""),
  );
  if (nicknameError) {
    redirect(`/mypage?tab=account&error=${encodeURIComponent(nicknameError)}`);
  }

  const { error } = await supabase.auth.updateUser({ data: { nickname } });
  if (error) {
    redirect(
      `/mypage?tab=account&error=${encodeURIComponent("닉네임 변경에 실패했어요.")}`,
    );
  }

  // 헤더 등 여러 서버 컴포넌트가 user_metadata.nickname을 읽어 렌더링하므로,
  // 이번 응답 이후 방문하는 페이지에 새 닉네임이 곧바로 반영되게 한다.
  revalidatePath("/", "layout");
  redirect(
    `/mypage?tab=account&message=${encodeURIComponent("닉네임을 변경했어요.")}`,
  );
}
