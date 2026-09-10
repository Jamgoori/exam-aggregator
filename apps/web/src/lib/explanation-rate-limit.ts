import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/ai-diagnosis";
import { FREE_EXPLANATION_DAILY_PAPERS } from "@gongmoa/core";

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
// 한도를 넘었는지 본다. 기록(insert)은 호출부가 판정 뒤에 따로 한다 — 읽기를 일일
// 한도 읽기와 나란히 보내기 위해 읽기와 쓰기를 갈라 두었다.
async function isWithinHourlyLimit(
  userId: string,
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

  return (count ?? 0) < limit;
}

async function logHourlyAccess(
  userId: string,
  paperId: string,
  action: ExplanationAccessAction,
): Promise<void> {
  await createAdminClient()
    .from("explanation_access_log")
    .insert({ user_id: userId, paper_id: paperId, action });
}

// 무료 회원이 오늘 연 문제지 목록. null 이면 조회 실패(스키마 미적용 등).
//
// explanation_daily_views 는 (user_id, view_date, paper_id)가 기본키라 같은 문제지를
// 몇 번 열어도 행이 하나뿐이다. 그래서 하루치 조회가 최대 세 행으로 끝나고, "오늘 이미
// 본 문제지인가"가 그냥 목록 포함 여부가 된다.
async function readFreeDailySeen(userId: string): Promise<string[] | null> {
  const { data, error } = await createAdminClient()
    .from("explanation_daily_views")
    .select("paper_id")
    .eq("user_id", userId)
    .eq("view_date", kstToday());
  if (error) return null;
  return (data ?? []).map((r) => r.paper_id as string);
}

// 무료 회원의 오늘 몫을 판정하고, 새 문제지면 오늘 목록에 올린다(읽은 값은 위에서
// 받아 넘긴다).
//
// 조회가 실패했으면(seen === null) 막지 않고 통과시킨다. 결제 유도 장치가 인프라
// 문제로 정상 사용자의 해설을 잠그는 쪽이, 잠깐 한도가 안 걸리는 쪽보다 나쁘다.
async function consumeFreeDailyQuota(
  userId: string,
  paperId: string,
  seen: string[] | null,
): Promise<ExplanationAccess> {
  if (seen === null) return FULL;

  const remainingAfter = (used: number) =>
    Math.max(0, FREE_EXPLANATION_DAILY_PAPERS - used);

  // 오늘 이미 연 문제지 — 한도를 깎지 않는다.
  if (seen.includes(paperId)) {
    return { full: true, reason: null, remainingToday: remainingAfter(seen.length) };
  }

  if (seen.length >= FREE_EXPLANATION_DAILY_PAPERS) {
    return { full: false, reason: "free-quota", remainingToday: 0 };
  }

  // 동시에 두 문제지를 열면 둘 다 통과할 수 있지만(읽고 쓰는 사이의 경합), 하루
  // 한 개 더 열리는 정도라 잠금을 걸어가며 막을 값이 아니다.
  await createAdminClient()
    .from("explanation_daily_views")
    .upsert(
      { user_id: userId, view_date: kstToday(), paper_id: paperId },
      { onConflict: "user_id,view_date,paper_id" },
    );

  return { full: true, reason: null, remainingToday: remainingAfter(seen.length + 1) };
}

// 해설 페이지가 부르는 단일 진입점. premium 은 호출부에서 판정해 넘긴다(관리자 포함).
//
// 순서가 중요하다: 시간당 한도를 먼저 본다. 수집 시도를 무료 일일 한도로 "결제하면
// 됩니다"라고 안내하면 안 되고, 한도에 걸린 요청 때문에 그날 몫이 깎여서도 안 된다.
export async function resolveExplanationAccess(input: {
  userId: string;
  paperId: string;
  action: ExplanationAccessAction;
  premium: boolean;
}): Promise<ExplanationAccess> {
  // 읽기 둘(시간당 기록 수, 오늘 연 문제지)은 서로 독립이라 같이 보내고, 판정 순서는
  // 그대로 지킨다 — 시간당 한도에 걸린 요청은 기록도 안 하고 그날 몫도 안 깎는다.
  // 예전에는 count → insert → select → upsert 가 차례로 네 왕복이었다.
  const [withinHourly, seen] = await Promise.all([
    isWithinHourlyLimit(input.userId, input.action),
    input.premium ? Promise.resolve(null) : readFreeDailySeen(input.userId),
  ]);
  if (!withinHourly) {
    return { full: false, reason: "rate-limit", remainingToday: null };
  }
  // 시간당 기록과 일일 몫 갱신은 서로 독립이라 나란히 쓴다.
  const [, access] = await Promise.all([
    logHourlyAccess(input.userId, input.paperId, input.action),
    input.premium
      ? Promise.resolve(FULL)
      : consumeFreeDailyQuota(input.userId, input.paperId, seen),
  ]);
  return access;
}
