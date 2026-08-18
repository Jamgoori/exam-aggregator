import { supabase } from "./supabase";
import { kstDateKey, kstMonthKey } from "@gongmoa/core";

// 월간 출석 조회. 웹 src/lib/attendance.ts 의 getAttendanceSummary 와 같은 질의다
// (규칙의 정본은 packages/core/src/attendance.ts).
//
// 읽기만 한다. 출석 기록·지급은 서버 채점 경로(Edge Function cbt-submit /
// review-submit)가 service_role 로만 한다 — attendance_days·attendance_grants 는
// select-own 정책뿐이라 앱이 직접 쓸 수 없고, 쓸 수 있으면 문제를 안 풀고도 출석이
// 되어 그대로 멤버십 기간으로 환전된다.

export type AttendanceSummary = {
  // "YYYY-MM-01" (KST).
  month: string;
  // "YYYY-MM-DD" (KST).
  today: string;
  attendedDates: string[];
  todayQuestions: number;
  grantedMilestones: number[];
};

export function emptyAttendanceSummary(): AttendanceSummary {
  return {
    month: kstMonthKey(),
    today: kstDateKey(),
    attendedDates: [],
    todayQuestions: 0,
    grantedMilestones: [],
  };
}

export async function getAttendanceSummary(): Promise<AttendanceSummary> {
  const today = kstDateKey();
  const month = kstMonthKey();
  // 다음 달 1일 — 범위의 열린 끝. 달마다 말일이 달라 28~31 을 세지 않는다.
  const [year, mon] = month.split("-").map(Number);
  const nextMonth = `${mon === 12 ? year + 1 : year}-${String(mon === 12 ? 1 : mon + 1).padStart(2, "0")}-01`;

  const [{ data: dayRows }, { data: grantRows }] = await Promise.all([
    supabase
      .from("attendance_days")
      .select("attend_date, question_count, qualified_at")
      .gte("attend_date", month)
      .lt("attend_date", nextMonth),
    supabase.from("attendance_grants").select("milestone").eq("month", month),
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
