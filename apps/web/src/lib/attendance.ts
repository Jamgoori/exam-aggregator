import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ATTENDANCE_MIN_QUESTIONS,
  attendanceMilestonesReached,
  kstDateKey,
  kstMonthKey,
} from "@gongmoa/core";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 출석 보상의 웹 서버측 경로. 규칙(단계·최소 문항 수·날짜 키)의 정본은
// packages/core/attendance.ts 이고, 여기는 그 규칙으로 DB 를 두드리는 일만 한다.
// Edge Function 쪽 같은 코드는 supabase/functions/_shared/attendance.ts 에 있다 —
// 한쪽만 고치면 웹에서 푼 날과 앱에서 푼 날의 출석 기준이 달라진다.
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
  if (!Number.isFinite(questionCount) || questionCount <= 0) return;

  const admin = createAdminClient();
  const now = new Date();
  const date = kstDateKey(now);
  const month = kstMonthKey(now);

  // 누계 증분과 "이 달 며칠째인가"를 한 번에 받는다(원자적 upsert + count).
  const { data, error } = await admin.rpc("record_attendance_day", {
    p_user_id: userId,
    p_date: date,
    p_questions: Math.floor(questionCount),
    p_min_questions: ATTENDANCE_MIN_QUESTIONS,
  });
  if (error) return;

  const attendedDays = typeof data === "number" ? data : 0;

  // 열린 단계를 전부 시도한다. 이미 준 단계는 DB 가 원장 충돌로 'already' 를
  // 돌려주므로, 여기서 "어디까지 줬는지"를 따로 기억하지 않아도 된다. 그 기억을
  // 앱이 들고 있으면 재시도·동시 채점에서 두 번 주는 경로가 생긴다.
  for (const milestone of attendanceMilestonesReached(attendedDays)) {
    await admin.rpc("grant_attendance_membership", {
      p_user_id: userId,
      p_month: month,
      p_milestone: milestone.days,
      p_days: milestone.grantDays,
    });
  }
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
