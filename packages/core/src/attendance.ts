// 출석 보상 규칙 — 웹·모바일 공유(순수 계산).
//
// "접속했다"가 아니라 "문제를 풀었다"를 출석으로 센다. 로그인만으로 도장을 주면
// 보상은 나가는데 시험 데이터는 안 쌓인다 — 이 기능을 만드는 이유가 사라진다.
//
// 연속(스트릭)이 아니라 누적이다. 수험생은 주 1회쯤 쉬고 모의고사·스터디 일정으로
// 하루씩 빠지는데, 연속으로 끊으면 한 번 놓친 사람이 그 달을 통째로 포기한다.
// 누적이면 놓친 다음 날 복귀 비용이 0이다. "오늘 안 오면 손해"라는 압박은 월간
// 리셋(마감 효과)이 대신한다 — 월말이 가까울수록 다음 단계까지 남은 날이 준다.
//
// 스트릭 자체는 없애지 않았다(streak.ts·tiers.ts). 다만 보상은 여기 한 곳에만 건다 —
// 두 체계에 다 보상이 걸리면 규칙 설명이 길어지고, 사용자가 어느 쪽을 채워야 하는지
// 모르게 된다.

// 하루치 출석으로 인정하는 최소 채점 문항 수.
//
// 복습 큐 하루 기본이 20문항(DUE_QUEUE_LIMIT), CBT 한 과목이 보통 20~25문항이라
// 그 절반이다. "잠깐 앉았다 갔다"와 "한 세션 했다"의 경계로 잡았다. 더 낮추면
// 한 문항 찍고 나가는 패턴이 도장을 먹고, 더 높이면 복습만 가볍게 도는 사용자가
// 출석을 못 받는다 — 그 사람들이 제일 꾸준히 데이터를 주는 쪽이다.
//
// CBT·복습·오답노트 다시풀기를 **합산**해서 센다. "CBT 제출 1건" 같은 단일 행위
// 조건으로 잡으면 복습 위주로 도는 사용자가 영원히 출석하지 못한다.
export const ATTENDANCE_MIN_QUESTIONS = 10;

export type AttendanceMilestone = {
  // 이 단계를 여는 그 달의 출석 일수.
  days: number;
  // 이 단계에서 추가로 주는 멤버십 일수(누적이 아니라 증분).
  grantDays: number;
};

// 한 달 안에서만 유효하다(매월 1일 KST 리셋).
//
// 마지막 단계가 28일인 것은 "월 개근"을 일부러 피한 것이다. 이유 둘:
//   1. 21일에서 개근(30·31일)까지 9~10일을 더 채워 2일을 받는 구조면 곡선의 마지막
//      구간이 가장 가혹해져, 대부분 21일에서 멈추고 최고 단계가 장식이 된다.
//      28일이면 "2~3일 빠져도 최고 단계"라 실제로 노리게 된다.
//   2. 달마다 일수가 달라(2월 28일 / 1월 31일) 개근의 난이도가 달라진다. 28일 고정은
//      모든 달이 같은 기준이다. 어느 달이든 28일은 존재하므로 항상 도달 가능하다.
export const ATTENDANCE_MILESTONES: readonly AttendanceMilestone[] = [
  { days: 7, grantDays: 1 },
  { days: 14, grantDays: 1 },
  { days: 21, grantDays: 1 },
  { days: 28, grantDays: 2 },
];

// 한 달에 받을 수 있는 멤버십 일수의 합(= 5일). 화면 문구가 이 숫자를 직접 적지
// 않게 여기서 계산한다 — 단계를 손볼 때 안내만 옛 값으로 남는 걸 막는다.
export const ATTENDANCE_MONTHLY_MAX_DAYS = ATTENDANCE_MILESTONES.reduce(
  (sum, m) => sum + m.grantDays,
  0,
);

// 이번 달 출석 일수로 열린 단계 전부(작은 것부터).
export function attendanceMilestonesReached(
  attendedDays: number,
): AttendanceMilestone[] {
  return ATTENDANCE_MILESTONES.filter((m) => attendedDays >= m.days);
}

// 이번 달 출석으로 지금까지 받은 멤버십 일수의 합.
export function attendanceEarnedDays(attendedDays: number): number {
  return attendanceMilestonesReached(attendedDays).reduce(
    (sum, m) => sum + m.grantDays,
    0,
  );
}

// 아직 열지 않은 다음 단계. 전부 열었으면 null.
export function nextAttendanceMilestone(
  attendedDays: number,
): AttendanceMilestone | null {
  return ATTENDANCE_MILESTONES.find((m) => attendedDays < m.days) ?? null;
}

export type AttendanceProgress = {
  attendedDays: number;
  // 이번 달에 이미 받은 멤버십 일수.
  earnedDays: number;
  // 이번 달에 더 받을 수 있는 일수(= 최대 - 받은 것).
  remainingDays: number;
  next: AttendanceMilestone | null;
  // 다음 단계까지 남은 출석 일수. 전부 열었으면 null.
  daysToNext: number | null;
};

export function attendanceProgress(attendedDays: number): AttendanceProgress {
  const earnedDays = attendanceEarnedDays(attendedDays);
  const next = nextAttendanceMilestone(attendedDays);
  return {
    attendedDays,
    earnedDays,
    remainingDays: ATTENDANCE_MONTHLY_MAX_DAYS - earnedDays,
    next,
    daysToNext: next ? next.days - attendedDays : null,
  };
}

// ── KST 날짜 키 ──────────────────────────────────────────────────────────────
// 하루의 경계는 AI 진단의 "일 1회"·무료 해설 일일 한도와 같은 KST 달력 날짜다.
// 사용자가 기억해야 할 하루 경계를 서비스 전체에서 하나로 두려는 것.
// (웹 lib/ai-diagnosis.ts 의 kstToday, Edge _shared/membership.ts 의 kstToday 와
//  같은 계산이다. 저쪽은 각자의 이유로 남아 있고, 출석은 이 함수를 쓴다.)

// "YYYY-MM-DD" (KST).
export function kstDateKey(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

// 그 날짜가 속한 달의 1일 — "YYYY-MM-01" (KST). 월간 카드의 키다.
export function kstMonthKey(now: Date = new Date()): string {
  return `${kstDateKey(now).slice(0, 7)}-01`;
}

// 그 달의 마지막 날짜(28~31). 달력 UI 가 몇 칸을 그릴지 정할 때 쓴다.
export function daysInMonthKey(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  // 다음 달 0일 = 이번 달 말일. UTC 로 계산해 실행 환경 시간대의 영향을 받지 않는다.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
