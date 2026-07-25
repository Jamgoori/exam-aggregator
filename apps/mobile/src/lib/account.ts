import { supabase } from "./supabase";
import { signOut } from "./auth";

// 회원 탈퇴. 실제 삭제는 service_role 이 필요해서 Edge Function(account-delete)이 한다.
// 성공하면 서버에 계정이 없으므로 남아 있는 로컬 세션도 함께 정리한다.
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke("account-delete");

  if (error) {
    // FunctionsHttpError 면 context 에 원본 Response 가 들어 있어 서버 메시지를 꺼낼 수 있다.
    const context = (error as { context?: Response }).context;
    let message: string | null = null;
    if (context && typeof context.json === "function") {
      const body = await context.json().catch(() => null);
      if (body && typeof body.error === "string") message = body.error;
    }
    throw new Error(message ?? "탈퇴 처리에 실패했어요. 잠시 후 다시 시도해 주세요.");
  }

  // 계정이 사라진 뒤라 서버 로그아웃 호출은 실패할 수 있다 — 로컬 정리만 되면 충분하다.
  await signOut().catch(() => {});
}
