import { callEdge } from "./edge";
import { signOut } from "./auth";

// 회원 탈퇴. 실제 삭제는 service_role 이 필요해서 Edge Function(account-delete)이 한다.
// 성공하면 서버에 계정이 없으므로 남아 있는 로컬 세션·캐시도 함께 정리한다(§7.1).
export async function deleteAccount(): Promise<void> {
  try {
    await callEdge("account-delete", {});
  } catch (e) {
    throw new Error(
      e instanceof Error && e.message ? e.message : "탈퇴 처리에 실패했어요. 잠시 후 다시 시도해 주세요.",
    );
  }
  // 계정이 사라진 뒤라 서버 로그아웃 호출은 실패할 수 있다 — 로컬 정리만 되면 충분하다.
  await signOut().catch(() => {});
}
