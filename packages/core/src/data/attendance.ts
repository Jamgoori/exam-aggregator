import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDateKey, kstMonthKey } from "../attendance";

// 월간 출석 카드 조회(DI) — 웹 lib/attendance.ts#getAttendanceSummary 를 옮긴 것(설계서 §6.2
// 출석 행 "data/attendance.ts — 웹·앱 중복 통합"). attendance_days·attendance_grants 는
// select-own 정책이라 사용자 세션 클라이언트로 충분하다. 쓰기는 채점 규칙(rules/
// attendance-record.ts)만 한다 — 여기는 읽기뿐.

export type AttendanceSummary = {
  // 이 카드가 가리키는 달 — "YYYY-MM-01" (KST).
  month: string;
  // 오늘 — "YYYY-MM-DD" (KST). 달력에서 오늘 칸을 표시할 때 쓴다.
  today: string;
  // 이번 달에 출석으로 인정된 날짜들("YYYY-MM-DD").
  attendedDates: string[];
  // 오늘 지금까지 채점된 문항 수. 아직 출석 전이면 "10문항 중 4문항"을 보여준다.
  todayQuestions: number;
  // 이미 지급된 단계의 기준 일수(5·10·…). 달력의 단계 눈금을 채운다.
  grantedMilestones: number[];
};

// 다음 달 1일 — 범위의 열린 끝. 달마다 말일이 달라 28~31 을 세지 않는다.
export function nextMonthKey(monthKey: string): string {
  const [year, mon] = monthKey.split("-").map(Number);
  return `${mon === 12 ? year + 1 : year}-${String(mon === 12 ? 1 : mon + 1).padStart(2, "0")}-01`;
}

// now 를 주입받는다 — 테스트와 "월이 바뀌는 순간"의 판정을 시계에 묶지 않기 위해서다(§8.3).
export async function fetchAttendanceSummary(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<AttendanceSummary> {
  const today = kstDateKey(now);
  const month = kstMonthKey(now);
  const nextMonth = nextMonthKey(month);

  const [{ data: dayRows }, { data: grantRows }] = await Promise.all([
    client
      .from("attendance_days")
      .select("attend_date, question_count, qualified_at")
      .eq("user_id", userId)
      .gte("attend_date", month)
      .lt("attend_date", nextMonth),
    client.from("attendance_grants").select("milestone").eq("user_id", userId).eq("month", month),
  ]);

  const days = (dayRows ?? []) as { attend_date: string; question_count: number | null; qualified_at: string | null }[];
  return {
    month,
    today,
    attendedDates: days.filter((d) => d.qualified_at !== null).map((d) => d.attend_date),
    todayQuestions: days.find((d) => d.attend_date === today)?.question_count ?? 0,
    grantedMilestones: ((grantRows ?? []) as { milestone: number }[]).map((g) => g.milestone),
  };
}
