import type { SupabaseClient } from "@supabase/supabase-js";
import { consumeFreeExplanationQuota } from "./membership-server";

// 해설 열람 접근 규칙 — 웹 papers/[id]/explanations 페이지와 Edge explanations-get 이
// 같은 함수를 쓴다(예전엔 Edge 가 시간당 한도·무료 몫을 따로 구현하고 있었다).
//
// 해설 열람에는 성격이 다른 두 개의 제한이 걸린다. 섞어 두면 "수집 막으려던 장치"가
// 요금제 문구로 새거나 그 반대가 되므로 분리해서 읽는다.
//
//  1) 시간당 한도(아래 상수) — 계정을 만들어 문제지 ID를 순회하며 통째로 긁어가는
//     걸 늦추려는 장치. 유료·무료를 가리지 않는다. 열람 40회/다운로드 80회는
//     실사용 범위(하루 여러 과목을 오가도 시간당 수십 개)보다 넉넉해 정상 사용자는
//     절대 걸리지 않는다.
//  2) 무료 회원 일일 한도 — 요금제다. 하루 문제지 3개(FREE_EXPLANATION_DAILY_PAPERS).
//     세는 단위가 "횟수"가 아니라 "문제지"라, 오늘 이미 연 문제지를 다시 여는 건
//     한도를 깎지 않는다.
export const EXPLANATION_VIEW_HOURLY_LIMIT = 40;
export const EXPLANATION_DOWNLOAD_HOURLY_LIMIT = 80;

// 비로그인(=크롤러 포함)과 한도에 걸린 요청에게 서버가 렌더링해 주는 미리보기 카드 수.
// 나머지는 응답에 아예 포함하지 않는다(CSS로 가리는 게 아니다) — 웹·앱 같은 값.
export const ANON_PREVIEW_CARDS = 2;

export type ExplanationAccessAction = "view" | "download";

// 전체 해설을 내줄지, 아니면 미리보기로 되돌릴지. 되돌릴 때 이유가 갈리는 이유는
// 화면 문구가 완전히 다르기 때문이다 — 하나는 "잠시 후 다시", 하나는 결제 유도다.
export type ExplanationAccess = {
  full: boolean;
  // full=false 일 때만 채워진다.
  reason: "rate-limit" | "free-quota" | null;
  // 무료 회원에게만 채워진다(유료·관리자는 null). 이번 요청을 반영한 잔여 수.
  remainingToday: number | null;
};

const FULL: ExplanationAccess = { full: true, reason: null, remainingToday: null };

// explanation_access_log 는 관리자 전용 RLS(정책 없음 = 전부 차단)라 service role로만
// 쓰고 읽는다. 최근 1시간 내 같은 사용자·같은 행동(view/download) 기록 수를 세어
// 한도를 넘으면 이번 요청은 기록하지 않고 false를 돌려준다.
async function withinHourlyLimit(
  admin: SupabaseClient,
  userId: string,
  paperId: string,
  action: ExplanationAccessAction,
  now: Date,
): Promise<boolean> {
  const limit =
    action === "view" ? EXPLANATION_VIEW_HOURLY_LIMIT : EXPLANATION_DOWNLOAD_HOURLY_LIMIT;
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

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

// 해설 페이지가 부르는 단일 진입점. premium 은 호출부에서 판정해 넘긴다(관리자 포함).
//
// 순서가 중요하다: 시간당 한도를 먼저 본다. 수집 시도를 무료 일일 한도로 "결제하면
// 됩니다"라고 안내하면 안 되고, 한도에 걸린 요청 때문에 그날 몫이 깎여서도 안 된다.
export async function resolveExplanationAccess(
  admin: SupabaseClient,
  input: {
    userId: string;
    paperId: string;
    action: ExplanationAccessAction;
    premium: boolean;
    now?: Date;
  },
): Promise<ExplanationAccess> {
  const now = input.now ?? new Date();
  if (!(await withinHourlyLimit(admin, input.userId, input.paperId, input.action, now))) {
    return { full: false, reason: "rate-limit", remainingToday: null };
  }
  if (input.premium) return FULL;
  const quota = await consumeFreeExplanationQuota(admin, input.userId, input.paperId, now);
  return quota.allowed
    ? { full: true, reason: null, remainingToday: quota.remainingToday }
    : { full: false, reason: "free-quota", remainingToday: 0 };
}
