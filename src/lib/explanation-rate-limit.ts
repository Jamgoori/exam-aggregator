import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// 열람 40회/다운로드 80회는 실사용 범위(공부하며 하루 여러 과목을 오가도 시간당
// 수십 개 수준)보다 넉넉히 잡은 값이라 정상 사용자는 절대 걸리지 않는다. 계정을
// 만들어 문제지 ID를 순회하며 통째로 긁어가려는 시도의 속도만 늦추는 게 목적이다.
export const EXPLANATION_VIEW_HOURLY_LIMIT = 40;
export const EXPLANATION_DOWNLOAD_HOURLY_LIMIT = 80;

export type ExplanationAccessAction = "view" | "download";

// explanation_access_log는 관리자 전용 RLS(정책 없음 = 전부 차단)라 service role로만
// 쓰고 읽는다. 최근 1시간 내 같은 사용자·같은 행동(view/download) 기록 수를 세어
// 한도를 넘으면 이번 요청은 기록하지 않고 false를 돌려준다 — 페이지 쪽에서는 이걸
// "전체 대신 미리보기로 보여줄지"만 판단하는 데 쓰고, 계정을 막거나 에러를 띄우지
// 않는다(완만하게 "잠시 후 다시"로만 처리).
export async function checkExplanationAccess(
  userId: string,
  paperId: string,
  action: ExplanationAccessAction,
): Promise<boolean> {
  const admin = createAdminClient();
  const limit =
    action === "view" ? EXPLANATION_VIEW_HOURLY_LIMIT : EXPLANATION_DOWNLOAD_HOURLY_LIMIT;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count } = await admin
    .from("explanation_access_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gte("created_at", oneHourAgo);

  if ((count ?? 0) >= limit) return false;

  await admin
    .from("explanation_access_log")
    .insert({ user_id: userId, paper_id: paperId, action });
  return true;
}
