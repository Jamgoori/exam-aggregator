// 웹 src/lib/attendance.ts 의 Deno 포팅본(공유). CBT 채점(cbt-submit)과 섞어풀기
// 채점(review-submit)이 모두 이걸 거쳐 출석을 남긴다.
//
// 규칙(단계·최소 문항 수·날짜 키)의 정본은 packages/core/src/attendance.ts 다.
// **여기에 숫자를 직접 적지 말 것** — 한쪽만 고치면 웹으로 푼 날과 앱으로 푼 날의
// 출석 기준이 달라진다. core 를 Deno 에서 그대로 import 할 수 없어 값만 옮겨 적되,
// 바꿀 때는 반드시 양쪽을 함께 고친다(TRIAL_DAYS·FREE_EXPLANATION_DAILY_PAPERS 와
// 같은 처리).
// deno-lint-ignore-file no-explicit-any

// packages/core/src/attendance.ts 의 ATTENDANCE_MIN_QUESTIONS 와 반드시 같은 값.
export const ATTENDANCE_MIN_QUESTIONS = 10;

// packages/core/src/attendance.ts 의 ATTENDANCE_MILESTONES 와 반드시 같은 값.
export const ATTENDANCE_MILESTONES: { days: number; grantDays: number }[] = [
  { days: 7, grantDays: 1 },
  { days: 14, grantDays: 1 },
  { days: 21, grantDays: 1 },
  { days: 28, grantDays: 2 },
];

// "YYYY-MM-DD" (KST). _shared/membership.ts 의 kstToday 와 같은 계산이다.
function kstDateKey(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

// 그 날짜가 속한 달의 1일 — "YYYY-MM-01" (KST).
function kstMonthKey(now: Date): string {
  return `${kstDateKey(now).slice(0, 7)}-01`;
}

// 채점 결과를 그날 출석 누계에 반영하고, 새로 열린 단계가 있으면 멤버십 기간을 준다.
//
// 채점의 부가 처리다 — 실패해도 채점을 되돌리지 않는다(호출부가 try/catch 로 삼킨다).
// 출석이 하루 밀리는 것보다 채점 결과가 사라지는 쪽이 비교할 수 없이 나쁘다.
export async function recordAttendance(
  admin: any,
  userId: string,
  questionCount: number,
): Promise<void> {
  if (!Number.isFinite(questionCount) || questionCount <= 0) return;

  const now = new Date();
  const month = kstMonthKey(now);

  // 누계 증분과 "이 달 며칠째인가"를 한 번에 받는다(원자적 upsert + count).
  const { data, error } = await admin.rpc("record_attendance_day", {
    p_user_id: userId,
    p_date: kstDateKey(now),
    p_questions: Math.floor(questionCount),
    p_min_questions: ATTENDANCE_MIN_QUESTIONS,
  });
  if (error) return;

  const attendedDays = typeof data === "number" ? data : 0;

  // 열린 단계를 전부 시도한다. 이미 준 단계는 DB 가 원장 충돌로 'already' 를
  // 돌려주므로, 여기서 "어디까지 줬는지"를 따로 기억하지 않아도 된다.
  for (const milestone of ATTENDANCE_MILESTONES) {
    if (attendedDays < milestone.days) continue;
    await admin.rpc("grant_attendance_membership", {
      p_user_id: userId,
      p_month: month,
      p_milestone: milestone.days,
      p_days: milestone.grantDays,
    });
  }
}
