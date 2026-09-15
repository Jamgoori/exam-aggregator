import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ATTENDANCE_MIN_QUESTIONS,
  attendanceMilestonesReached,
  isAttendanceOpen,
  kstDateKey,
  kstMonthKey,
} from "../attendance";

// 출석 보상의 서버측 경로. 규칙(단계·최소 문항 수·날짜 키)의 정본은
// ../attendance.ts 이고, 여기는 그 규칙으로 DB 를 두드리는 일만 한다. 웹 서버 액션
// (CBT·복습·섞어풀기 채점)과 Edge Function(cbt-submit·review-submit)이 같은 이
// 함수를 부른다 — 예전엔 Edge 에 상수까지 옮겨 적은 포팅본이 있어, 한쪽만 고치면
// 웹에서 푼 날과 앱에서 푼 날의 출석 기준이 달라졌다.
//
// 쓰기는 전부 service_role 로 한다. attendance_days·attendance_grants 는 select-own 만
// 열려 있고 쓰기 정책이 없다 — 클라이언트가 직접 올릴 수 있으면 문제를 안 풀고도
// 출석이 되고, 그대로 멤버십 기간으로 환전된다.

// 채점 결과를 그날 출석 누계에 반영하고, 새로 열린 단계가 있으면 멤버십 기간을 준다.
//
// 채점의 부가 처리다 — 실패해도 채점을 되돌리지 않는다(호출부가 try/catch 로 삼킨다).
// 출석이 하루 밀리는 것보다 채점 결과가 사라지는 쪽이 비교할 수 없이 나쁘다.
export async function recordAttendance(
  admin: SupabaseClient,
  userId: string,
  questionCount: number,
  opts: { now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();

  // 출석체크가 닫혀 있는 동안(전면 무료 이벤트)에는 기록도 지급도 하지 않는다.
  // 이유는 isAttendanceOpen 머리말에 있다. 웹·Edge 가 같은 함수를 쓰므로 한쪽에서만
  // 도장이 계속 찍히는 일은 이제 구조적으로 없다.
  if (!isAttendanceOpen(now)) return;
  if (!Number.isFinite(questionCount) || questionCount <= 0) return;

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
