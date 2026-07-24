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
