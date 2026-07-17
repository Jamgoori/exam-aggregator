"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { validateNickname } from "@/lib/nickname";

async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocol =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

// 로그인/가입은 소셜 로그인(구글·카카오)으로만 받는다. 이메일/비밀번호 방식은 계정 복구
// (아이디·비밀번호 찾기)를 전부 자체 구현해야 해서 폐쇄했고, 복구·비밀번호 보안을
// provider에 위임한다. provider 값은 반드시 이 화이트리스트 안에서만 쓴다 — 폼 데이터로
// provider 문자열을 받아 그대로 넘기면 대시보드에 켜지 않은 provider로도 시도가 가능해진다.
async function signInWithProvider(provider: "google" | "kakao", formData: FormData) {
  const origin = await getOrigin();
  const next = sanitizeNextPath(String(formData.get("next") ?? ""));
  const supabase = await createClient();

  // redirectTo는 Supabase 대시보드의 Redirect URLs 허용 목록으로 한 번 더 검증되고,
  // next는 sanitizeNextPath로 사이트 내부 경로로만 좁혀 오픈 리다이렉트를 막는다.
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error || !data.url) {
    redirect(
      `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent("로그인을 시작할 수 없어요. 잠시 후 다시 시도해주세요")}`,
    );
  }

  redirect(data.url);
}

export async function signInWithGoogle(formData: FormData) {
  await signInWithProvider("google", formData);
}

export async function signInWithKakao(formData: FormData) {
  await signInWithProvider("kakao", formData);
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
  const { supabase, user } = await getSessionUser();

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
  // 온보딩 경유 = 신규 가입 완료이므로 GA4 sign_up 이벤트용 표식(signup=1)을 붙인다
  // (SignupEventTracker가 이벤트 전송 후 URL에서 지운다).
  if (formPath.startsWith("/onboarding/nickname")) {
    redirect(withQuery(successPath, "signup", "1"));
  }
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

  const { supabase, user } = await getSessionUser();

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
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인이 필요해요." };

  const nicknameResult = validateNickname(rawNickname);
  if (nicknameResult.error !== null) return { error: nicknameResult.error };

  const { error } = await persistNickname(supabase, user.id, nicknameResult.nickname);
  if (error) return { error };
  return { success: true };
}

// CBT 온라인 응시를 시작할 때 "전체보기"/"문제별 풀기" 중 어느 화면으로 열지에 대한
// 계정별 선호값. 닉네임과 마찬가지로 별도 테이블 없이 user_metadata에 둔다(고유성
// 검증이나 다른 계정과의 조회가 필요 없는 단순 preference라 profiles 테이블 대상이
// 아니다).
// mode가 null이면 저장된 기본값을 지운다 (CBT 화면 자물쇠를 다시 눌러 잠금을
// 해제하는 경우).
export async function setDefaultCbtViewMode(
  mode: "full" | "single" | null,
): Promise<{ error?: string; success?: boolean }> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인이 필요해요." };

  const { error } = await supabase.auth.updateUser({
    data: { default_cbt_view_mode: mode },
  });
  if (error) return { error: "저장에 실패했어요." };
  return { success: true };
}

