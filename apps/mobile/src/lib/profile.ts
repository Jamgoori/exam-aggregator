import { avatarPublicUrl, validateNickname } from "@gongmoa/core";
import { SUPABASE_URL, supabase } from "./supabase";

// 닉네임 설정/수정. user_metadata.nickname 에 저장한다(소셜 콜백이 이 값으로 온보딩
// 여부를 판단). 중복은 is_nickname_taken RPC 로 확인(웹과 동일 규칙). DB 트리거
// sync_nickname_from_auth 가 profiles upsert·금칙어를 강제하므로 웹의 admin upsert
// 경로는 앱에 불필요(§7.1).
const TRIGGER_MESSAGES = [
  "닉네임은 2~10자로 입력해주세요.",
  "닉네임에 사용할 수 없는 문자가 포함되어 있어요.",
  "사용할 수 없는 닉네임이에요.",
];

// 중복확인만(저장 없음) — 웹 mypage/edit nickname-field.tsx 의 "중복확인" 버튼(app/actions.ts
// checkNicknameAvailable). 형식 오류는 던지고, 결과는 사용 가능 여부.
export async function checkNicknameAvailable(raw: string): Promise<{ available: boolean; nickname: string }> {
  const v = validateNickname(raw);
  if (v.error !== null) throw new Error(v.error);

  const { data: userData } = await supabase.auth.getUser();
  const { data: taken, error: rpcError } = await supabase.rpc("is_nickname_taken", {
    check_nickname: v.nickname,
    exclude_user_id: userData.user?.id ?? null,
  });
  if (rpcError) throw new Error("닉네임 확인에 실패했어요.");
  return { available: !taken, nickname: v.nickname };
}

export async function updateNickname(raw: string): Promise<void> {
  const v = validateNickname(raw);
  if (v.error) throw new Error(v.error);

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  const { data: taken, error: rpcError } = await supabase.rpc("is_nickname_taken", {
    check_nickname: v.nickname,
    exclude_user_id: userId ?? null,
  });
  if (rpcError) throw new Error("닉네임 확인에 실패했어요.");
  if (taken) throw new Error("이미 사용 중인 닉네임이에요.");

  const { error } = await supabase.auth.updateUser({ data: { nickname: v.nickname } });
  if (error) {
    // 트리거 문구는 그대로, 유니크 위반(선검사와 경합)은 "이미 사용 중" 으로(§7.1 오류 매핑).
    const hit = TRIGGER_MESSAGES.find((m) => error.message.includes(m));
    if (hit) throw new Error(hit);
    if (error.message.includes("23505")) throw new Error("이미 사용 중인 닉네임이에요.");
    throw new Error("닉네임 저장에 실패했어요.");
  }
  // 헤더·드로어가 JWT 의 user_metadata 를 읽으므로 세션을 갱신해 새 닉네임을 태운다.
  await supabase.auth.refreshSession().catch(() => {});
}

export function currentNickname(metadata: Record<string, unknown> | undefined): string | null {
  const n = metadata?.nickname;
  return typeof n === "string" && n.length > 0 ? n : null;
}

// 프로필 사진 경로(user_metadata.avatar_path) → 공개 URL. 웹 lib/avatars.ts 와 같은 규칙.
export function currentAvatarUrl(metadata: Record<string, unknown> | undefined): string | null {
  const p = metadata?.avatar_path;
  return avatarPublicUrl(SUPABASE_URL, typeof p === "string" ? p : null);
}

// ── CBT 시작 화면 설정 ────────────────────────────────────────────────────────
// 웹 mypage/edit 의 "CBT 시작 화면"과 같은 값(user_metadata.default_cbt_view_mode)을
// 공유한다. null 은 "잠금 없음"(사이트 기본 = 문제별) — 앱도 해제를 지원한다(§7.1).
export type CbtViewMode = "single" | "full";

export function currentCbtViewMode(metadata: Record<string, unknown> | undefined): CbtViewMode | null {
  const v = metadata?.default_cbt_view_mode;
  return v === "full" || v === "single" ? v : null;
}

export async function updateCbtViewMode(mode: CbtViewMode | null): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    data: { default_cbt_view_mode: mode },
  });
  if (error) throw new Error("설정 저장에 실패했어요.");
  await supabase.auth.refreshSession().catch(() => {});
}
