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

// 출석으로 인정할 최소 소요 시간(답을 고른 문항 하나당 초).
//
// CBT 채점은 서버가 기록한 시작 시각으로 최소 응시시간(90초)을 강제하는데, 섞어풀기
// 채점에는 그런 하한이 아예 없었다. 세션을 만들자마자 빈 답안으로 제출하는 것만으로
// 그날 출석이 찍혔고, 출석은 grant_attendance_membership 을 통해 **실제 멤버십 일수로
// 환전된다** — 문제를 한 문항도 풀지 않고 매달 유료 기간을 받아가는 경로였다.
//
// 문항 수에 비례한 하한을 쓴다. 5문항 세션과 50문항 세션에 같은 초를 요구하면 짧은
// 세션이 억울하게 막힌다. 문항당 2초는 "문제를 읽지도 않았다"의 경계다 — 실제로 푸는
// 사람은 기출 한 문항에 수십 초를 쓴다. 여기 걸려서 진짜 사용자의 도장이 빠지는 쪽이
// 훨씬 나쁘므로 넉넉하게 잡는다.
export const ATTENDANCE_MIN_SECONDS_PER_QUESTION = 2;

// 이번 채점에서 출석으로 셀 문항 수. 0 이면 출석을 남기지 않는다.
//
// 두 가지를 본다:
//  · 답을 고르지 않은 문항은 세지 않는다. "채점된 문항"이 아니라 "푼 문항"이 출석이라,
//    빈 답안을 문항 수만 채워 보내는 것으로는 도장이 찍히지 않아야 한다.
//  · 답을 골랐더라도 세션 전체가 너무 빨리 끝났으면 0 이다. 답안 배열을 즉석에서
//    만들어 보내는 스크립트를 여기서 끊는다.
export function attendanceQuestionCount(input: {
  // 실제로 답을 고른 문항 수(선택 안 한 문항 제외).
  answeredCount: number;
  // 세션 시작(또는 응시 시작)부터 제출까지 서버가 잰 시간. 클라이언트가 보낸 값이 아니어야 한다.
  elapsedSeconds: number;
}): number {
  const answered = Math.floor(input.answeredCount);
  if (!Number.isFinite(answered) || answered <= 0) return 0;
  if (!Number.isFinite(input.elapsedSeconds)) return 0;
  const required = answered * ATTENDANCE_MIN_SECONDS_PER_QUESTION;
  return input.elapsedSeconds >= required ? answered : 0;
}

export type AttendanceMilestone = {
  // 이 단계를 여는 그 달의 출석 일수.
  days: number;
  // 이 단계에서 추가로 주는 멤버십 일수(누적이 아니라 증분).
  grantDays: number;
};

// 한 달 안에서만 유효하다(매월 1일 KST 리셋).
//
// 5일 간격으로 다섯 단계다. 7일 간격(7·14·21·28)이었던 것을 5일로 좁힌 이유는
// **첫 보상까지의 거리**다. 처음 온 사람이 7일을 채워야 아무 일도 안 일어나는 구조는
// 대부분 3~4일에서 이탈하고, 그 사람은 보상을 한 번도 못 본 채로 판단을 끝낸다.
// 5일이면 첫 주 안에 실제로 한 번 받아보게 되고, 그 다음부터는 "10일까지 5일 남았다"가
// 계속 짧은 목표로 이어진다.
//
// 마지막 단계가 25일인 것은 "월 개근"을 일부러 피한 것이다. 이유 둘:
//   1. 20일에서 개근(30·31일)까지 10~11일을 더 채워 2일을 받는 구조면 곡선의 마지막
//      구간이 가장 가혹해져, 대부분 20일에서 멈추고 최고 단계가 장식이 된다.
//      25일이면 "닷새쯤 빠져도 최고 단계"라 실제로 노리게 된다.
//   2. 달마다 일수가 달라(2월 28일 / 1월 31일) 개근의 난이도가 달라진다. 25일 고정은
//      모든 달이 같은 기준이다. 어느 달이든 25일은 존재하므로 항상 도달 가능하다.
//
// 마지막만 2일인 것은 앞의 네 단계와 같은 1일이면 25일째가 20일째와 구별되지 않기
// 때문이다. 끝에 한 번 크게 주는 쪽이 마지막 구간을 버티게 한다.
export const ATTENDANCE_MILESTONES: readonly AttendanceMilestone[] = [
  { days: 5, grantDays: 1 },
  { days: 10, grantDays: 1 },
  { days: 15, grantDays: 1 },
  { days: 20, grantDays: 1 },
  { days: 25, grantDays: 2 },
];

// 한 달에 받을 수 있는 멤버십 일수의 합(= 6일). 화면 문구가 이 숫자를 직접 적지
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

// 어느 날짜에서 어느 단계를 달성했는지 — "YYYY-MM-DD" → 그 날 열린 단계.
//
// 달력이 축하를 그리려면 "5일째 출석한 날이 며칠이었나"를 알아야 하는데, DB 에는
// 그게 없다. attendance_grants 에는 단계와 지급일만 남고, 지급은 채점 직후가 아니라
// 재시도로 밀릴 수도 있어 지급 시각을 달성일로 쓰면 엉뚱한 칸에 축하가 붙는다.
// 그래서 출석한 날짜들을 날짜순으로 세어 n번째 날을 단계와 맞춘다 — 이 계산이
// 정본이고, 웹·앱이 같은 칸에 축하를 그린다.
//
// 누적 규칙이라 순서가 곧 등수다: 정렬한 뒤 5·10·15·20·25번째 날짜가 달성일이다.
export function attendanceMilestoneDates(
  attendedDates: readonly string[],
): Map<string, AttendanceMilestone> {
  // 같은 날짜가 두 번 들어오면 등수가 밀려 축하가 하루 당겨진다(호출부가 Set 을
  // 풀어 넘기는 경우가 많아 실제로는 드물지만, 여기서 막는 편이 싸다).
  const sorted = [...new Set(attendedDates)].sort();
  const byDate = new Map<string, AttendanceMilestone>();
  for (const milestone of ATTENDANCE_MILESTONES) {
    const date = sorted[milestone.days - 1];
    if (date) byDate.set(date, milestone);
  }
  return byDate;
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

// 같은 하루 경계를 정수 하나로 — 1970-01-01 KST 를 0 으로 센 날짜 번호.
//
// kstDateKey 와 자르는 지점이 완전히 같다(KST 00:00). 다른 건 결과의 모양뿐이라,
// "며칠 전인지"를 세거나 하루를 Set/Map 의 키로 쓸 때는 이쪽이 맞다:
//   - 문자열 키는 만들 때마다 Intl 포맷이 돈다. 응시 1,000행이면 그게 1,000번이다.
//   - 어제를 구하려면 문자열을 Date 로 되돌렸다 하루 빼고 다시 포맷해야 한다.
//     정수는 -1 이면 끝이다.
// KST 는 서머타임이 없어 하루가 언제나 정확히 24시간이므로 나눗셈이 성립한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function kstDayIndex(at: Date): number {
  return Math.floor((at.getTime() + KST_OFFSET_MS) / DAY_MS);
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
