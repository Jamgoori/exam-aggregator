import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstDateKey, kstMonthKey } from "@gongmoa/core";
import { recordAttendance as recordAttendanceRule } from "@gongmoa/core/server";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 출석 보상의 웹 서버측 경로. 규칙(단계·최소 문항 수·날짜 키)의 정본은
// packages/core/attendance.ts 이고, DB 를 두드리는 본문은 packages/core/src/rules/
// attendance-record.ts 에 있다 — Edge Function(cbt-submit·review-submit)도 번들
// (_shared/core.mjs)로 같은 함수를 부르므로 웹에서 푼 날과 앱에서 푼 날의 출석 기준이
// 갈릴 수 없다. 여기는 service_role 클라이언트를 만들어 넘기는 일만 한다.
//
// 쓰기는 전부 service_role 로 한다. attendance_days·attendance_grants 는 select-own 만
// 열려 있고 쓰기 정책이 없다 — 클라이언트가 직접 올릴 수 있으면 문제를 안 풀고도
// 출석이 되고, 그대로 멤버십 기간으로 환전된다.

// 채점 결과를 그날 출석 누계에 반영하고, 새로 열린 단계가 있으면 멤버십 기간을 준다.
//
// 채점의 부가 처리다 — 실패해도 채점을 되돌리지 않는다(호출부가 try/catch 로 삼킨다).
// 출석이 하루 밀리는 것보다 채점 결과가 사라지는 쪽이 비교할 수 없이 나쁘다.
export async function recordAttendance(
  userId: string,
  questionCount: number,
): Promise<void> {
  // 닫혀 있거나(전면 무료 이벤트) 셀 문항이 없으면 규칙 쪽이 바로 돌아온다 — 그 검사
  // 전에 admin 클라이언트를 만드는 비용은 무시할 만하다.
  await recordAttendanceRule(createAdminClient(), userId, questionCount);
}

export type AttendanceSummary = {
  // 이 카드가 가리키는 달 — "YYYY-MM-01" (KST).
  month: string;
  // 오늘 — "YYYY-MM-DD" (KST). 달력에서 오늘 칸을 표시할 때 쓴다.
  today: string;
  // 이번 달에 출석으로 인정된 날짜들("YYYY-MM-DD").
  attendedDates: string[];
  // 오늘 지금까지 채점된 문항 수. 아직 출석 전이면 "10문항 중 4문항"을 보여준다.
  todayQuestions: number;
  // 이미 지급된 단계의 기준 일수(7·14·21·28). 달력의 단계 눈금을 채운다.
  grantedMilestones: number[];
};

// 마이페이지 출석 카드가 쓰는 조회. 본인 행만 읽으므로 사용자 세션 클라이언트로
// 충분하다(select-own 정책).
export async function getAttendanceSummary(
  supabase: Supabase,
  userId: string,
): Promise<AttendanceSummary> {
  const now = new Date();
  const today = kstDateKey(now);
  const month = kstMonthKey(now);
  // 다음 달 1일 — 범위의 열린 끝. 달마다 말일이 달라 28~31 을 세지 않는다.
  const [year, mon] = month.split("-").map(Number);
  const nextMonth = `${mon === 12 ? year + 1 : year}-${String(mon === 12 ? 1 : mon + 1).padStart(2, "0")}-01`;

  const [{ data: dayRows }, { data: grantRows }] = await Promise.all([
    supabase
      .from("attendance_days")
      .select("attend_date, question_count, qualified_at")
      .eq("user_id", userId)
      .gte("attend_date", month)
      .lt("attend_date", nextMonth),
    supabase
      .from("attendance_grants")
      .select("milestone")
      .eq("user_id", userId)
      .eq("month", month),
  ]);

  const days = dayRows ?? [];
  return {
    month,
    today,
    attendedDates: days
      .filter((d) => d.qualified_at !== null)
      .map((d) => d.attend_date as string),
    todayQuestions:
      (days.find((d) => d.attend_date === today)?.question_count as number | undefined) ?? 0,
    grantedMilestones: (grantRows ?? []).map((g) => g.milestone as number),
  };
}
