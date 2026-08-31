import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MIN_SECONDS_PER_QUESTION,
  attendanceQuestionCount,
  ATTENDANCE_MONTHLY_MAX_DAYS,
  attendanceEarnedDays,
  attendanceMilestoneDates,
  attendanceMilestonesReached,
  attendanceProgress,
  daysInMonthKey,
  isAttendanceOpen,
  kstDateKey,
  kstMonthKey,
  nextAttendanceMilestone,
} from "./attendance";

test("월 최대 지급은 6일이다", () => {
  assert.equal(ATTENDANCE_MONTHLY_MAX_DAYS, 6);
});

test("단계는 5일 간격 다섯 개이고 마지막이 25일이다 — 어느 달에도 존재하는 날짜여야 한다", () => {
  assert.deepEqual(
    ATTENDANCE_MILESTONES.map((m) => m.days),
    [5, 10, 15, 20, 25],
  );
  assert.deepEqual(
    ATTENDANCE_MILESTONES.map((m) => m.grantDays),
    [1, 1, 1, 1, 2],
  );
});

test("열린 단계: 경계값에서 바로 열린다", () => {
  assert.deepEqual(attendanceMilestonesReached(4), []);
  assert.deepEqual(
    attendanceMilestonesReached(5).map((m) => m.days),
    [5],
  );
  assert.deepEqual(
    attendanceMilestonesReached(24).map((m) => m.days),
    [5, 10, 15, 20],
  );
  assert.deepEqual(
    attendanceMilestonesReached(25).map((m) => m.days),
    [5, 10, 15, 20, 25],
  );
});

test("지급 일수 누적: 0 → 1 → 2 → 3 → 4 → 6", () => {
  assert.equal(attendanceEarnedDays(0), 0);
  assert.equal(attendanceEarnedDays(4), 0);
  assert.equal(attendanceEarnedDays(5), 1);
  assert.equal(attendanceEarnedDays(9), 1);
  assert.equal(attendanceEarnedDays(10), 2);
  assert.equal(attendanceEarnedDays(15), 3);
  assert.equal(attendanceEarnedDays(20), 4);
  assert.equal(attendanceEarnedDays(25), 6);
});

test("31일을 다 채워도 25일과 같다 — 25일 이후엔 더 주지 않는다", () => {
  assert.equal(attendanceEarnedDays(31), ATTENDANCE_MONTHLY_MAX_DAYS);
});

test("다음 단계", () => {
  assert.equal(nextAttendanceMilestone(0)?.days, 5);
  assert.equal(nextAttendanceMilestone(5)?.days, 10);
  assert.equal(nextAttendanceMilestone(24)?.days, 25);
  assert.equal(nextAttendanceMilestone(25), null);
});

test("진행 상황: 남은 일수와 다음 단계까지 남은 날", () => {
  assert.deepEqual(attendanceProgress(7), {
    attendedDays: 7,
    earnedDays: 1,
    remainingDays: 5,
    next: { days: 10, grantDays: 1 },
    daysToNext: 3,
  });
  assert.deepEqual(attendanceProgress(25), {
    attendedDays: 25,
    earnedDays: 6,
    remainingDays: 0,
    next: null,
    daysToNext: null,
  });
});

test("달성일: 정렬한 n번째 출석일이 단계의 축하 칸이다", () => {
  // 1일부터 12일까지 매일 출석 — 5번째(5일)와 10번째(10일)에 축하가 붙는다.
  const dates = Array.from(
    { length: 12 },
    (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`,
  );
  const byDate = attendanceMilestoneDates(dates);
  assert.deepEqual([...byDate.keys()], ["2026-08-05", "2026-08-10"]);
  assert.deepEqual(byDate.get("2026-08-05"), { days: 5, grantDays: 1 });
});

test("달성일: 빠진 날이 있으면 날짜가 아니라 등수로 센다", () => {
  // 3·6·9·12·20일 출석 = 다섯 번째 출석일이 20일 → 20일 칸에 축하.
  const byDate = attendanceMilestoneDates([
    "2026-08-12",
    "2026-08-03",
    "2026-08-20",
    "2026-08-06",
    "2026-08-09",
  ]);
  assert.deepEqual([...byDate.keys()], ["2026-08-20"]);
});

test("달성일: 아직 단계에 못 닿았으면 비어 있다", () => {
  assert.equal(attendanceMilestoneDates(["2026-08-01", "2026-08-02"]).size, 0);
});

test("달성일: 같은 날짜가 중복으로 들어와도 등수가 밀리지 않는다", () => {
  const dates = [
    ...Array.from({ length: 5 }, (_, i) => `2026-08-0${i + 1}`),
    "2026-08-03",
  ];
  assert.deepEqual([...attendanceMilestoneDates(dates).keys()], ["2026-08-05"]);
});

test("KST 날짜 키: UTC 자정 직전은 이미 다음 날이다", () => {
  // 2026-08-17T20:00Z = KST 2026-08-18 05:00
  assert.equal(kstDateKey(new Date("2026-08-17T20:00:00.000Z")), "2026-08-18");
  // 2026-08-17T14:59Z = KST 2026-08-17 23:59 — 아직 전날이다.
  assert.equal(kstDateKey(new Date("2026-08-17T14:59:00.000Z")), "2026-08-17");
});

test("KST 월 키: 월말 밤은 이미 다음 달이다", () => {
  assert.equal(kstMonthKey(new Date("2026-08-18T03:00:00.000Z")), "2026-08-01");
  // 2026-08-31T15:00Z = KST 2026-09-01 00:00 — 카드가 이미 9월로 넘어간다.
  assert.equal(kstMonthKey(new Date("2026-08-31T15:00:00.000Z")), "2026-09-01");
});

test("달의 일수: 2월과 윤년", () => {
  assert.equal(daysInMonthKey("2026-02-01"), 28);
  assert.equal(daysInMonthKey("2028-02-01"), 29);
  assert.equal(daysInMonthKey("2026-04-01"), 30);
  assert.equal(daysInMonthKey("2026-12-01"), 31);
});

// 출석은 grant_attendance_membership 을 통해 실제 멤버십 일수로 환전된다. 그래서
// "문제를 풀지 않고 제출만 하는" 경로가 도장을 받으면 결제 없이 유료 기간이 나간다.
test("답을 고르지 않은 문항은 출석으로 세지 않는다", () => {
  assert.equal(attendanceQuestionCount({ answeredCount: 0, elapsedSeconds: 9999 }), 0);
  assert.equal(attendanceQuestionCount({ answeredCount: -5, elapsedSeconds: 9999 }), 0);
});

test("세션이 너무 빨리 끝나면 출석으로 세지 않는다", () => {
  // 20문항을 1초 만에 제출 — 스크립트다.
  assert.equal(attendanceQuestionCount({ answeredCount: 20, elapsedSeconds: 1 }), 0);
  // 문항당 하한(2초)에 미달.
  assert.equal(
    attendanceQuestionCount({ answeredCount: 20, elapsedSeconds: 20 * ATTENDANCE_MIN_SECONDS_PER_QUESTION - 1 }),
    0,
  );
});

test("실제로 풀면 그대로 센다", () => {
  // 20문항을 10분에 — 평범한 복습 한 세션.
  assert.equal(attendanceQuestionCount({ answeredCount: 20, elapsedSeconds: 600 }), 20);
  // 하한 경계는 통과시킨다(걸려서 진짜 사용자의 도장이 빠지는 쪽이 더 나쁘다).
  assert.equal(
    attendanceQuestionCount({ answeredCount: 10, elapsedSeconds: 10 * ATTENDANCE_MIN_SECONDS_PER_QUESTION }),
    10,
  );
  // 일부만 풀어도 푼 만큼은 센다(기준 10문항을 넘으면 출석).
  assert.equal(attendanceQuestionCount({ answeredCount: 12, elapsedSeconds: 300 }), 12);
});

test("이상한 값은 0 으로 떨어뜨린다", () => {
  assert.equal(attendanceQuestionCount({ answeredCount: NaN, elapsedSeconds: 600 }), 0);
  assert.equal(attendanceQuestionCount({ answeredCount: 10, elapsedSeconds: NaN }), 0);
});

// ── 이벤트 기간 동안 출석체크는 닫혀 있다 ───────────────────────────────────
// 보상이 멤버십 일수뿐인데 그 기간엔 이미 모두에게 열려 있어서 줄 것이 없고,
// 그대로 두면 이벤트 종료일 뒤로 붙는 유료 기간이 조용히 쌓인다.
test("isAttendanceOpen: 전면 무료 기간에는 닫히고, 끝나면 다시 열린다", () => {
  assert.equal(isAttendanceOpen(new Date("2026-09-01T00:00:00+09:00")), false);
  assert.equal(isAttendanceOpen(new Date("2027-06-30T23:59:59+09:00")), false);
  assert.equal(isAttendanceOpen(new Date("2027-07-01T00:00:00+09:00")), true);
});
