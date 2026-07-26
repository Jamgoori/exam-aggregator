import { supabase } from "./supabase";
import { validateNickname } from "@gongmoa/core";

// 닉네임 설정/수정. user_metadata.nickname 에 저장한다(소셜 콜백이 이 값으로 온보딩
// 여부를 판단). 중복은 is_nickname_taken RPC 로 확인(웹과 동일 규칙).
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
  if (error) throw new Error("닉네임 저장에 실패했어요.");
}

export function currentNickname(metadata: Record<string, unknown> | undefined): string | null {
  const n = metadata?.nickname;
  return typeof n === "string" && n.length > 0 ? n : null;
}

// ── CBT 시작 화면 설정 ────────────────────────────────────────────────────────
// 웹 mypage/edit 의 "CBT 시작 화면"과 같은 값(user_metadata.default_cbt_view_mode)을
// 공유한다. 웹에서 바꾼 설정이 앱에도, 앱에서 바꾼 설정이 웹에도 그대로 반영된다.
export type CbtViewMode = "single" | "full";

export function currentCbtViewMode(
  metadata: Record<string, unknown> | undefined,
): CbtViewMode {
  // 명시적으로 잠긴 값이 없으면 사이트 기본값인 "문제별 풀기"(single).
  return metadata?.default_cbt_view_mode === "full" ? "full" : "single";
}

export async function updateCbtViewMode(mode: CbtViewMode): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    data: { default_cbt_view_mode: mode },
  });
  if (error) throw new Error("설정 저장에 실패했어요.");
}
