import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MONTHLY_MAX_DAYS,
  attendanceEarnedDays,
  attendanceMilestonesReached,
  attendanceProgress,
  daysInMonthKey,
  kstDateKey,
  kstMonthKey,
  nextAttendanceMilestone,
} from "./attendance";

test("월 최대 지급은 5일이다", () => {
  assert.equal(ATTENDANCE_MONTHLY_MAX_DAYS, 5);
});

test("단계는 오름차순이고 마지막이 28일이다 — 어느 달에도 존재하는 날짜여야 한다", () => {
  const days = ATTENDANCE_MILESTONES.map((m) => m.days);
  assert.deepEqual(days, [...days].sort((a, b) => a - b));
  assert.equal(days[days.length - 1], 28);
});

test("열린 단계: 경계값에서 바로 열린다", () => {
  assert.deepEqual(attendanceMilestonesReached(6), []);
  assert.deepEqual(
    attendanceMilestonesReached(7).map((m) => m.days),
    [7],
  );
  assert.deepEqual(
    attendanceMilestonesReached(27).map((m) => m.days),
    [7, 14, 21],
  );
  assert.deepEqual(
    attendanceMilestonesReached(28).map((m) => m.days),
    [7, 14, 21, 28],
  );
});

test("지급 일수 누적: 0 → 1 → 2 → 3 → 5", () => {
  assert.equal(attendanceEarnedDays(0), 0);
  assert.equal(attendanceEarnedDays(6), 0);
  assert.equal(attendanceEarnedDays(7), 1);
  assert.equal(attendanceEarnedDays(13), 1);
  assert.equal(attendanceEarnedDays(14), 2);
  assert.equal(attendanceEarnedDays(21), 3);
  assert.equal(attendanceEarnedDays(28), 5);
});

test("31일을 다 채워도 28일과 같다 — 28일 이후엔 더 주지 않는다", () => {
  assert.equal(attendanceEarnedDays(31), ATTENDANCE_MONTHLY_MAX_DAYS);
});

test("다음 단계", () => {
  assert.equal(nextAttendanceMilestone(0)?.days, 7);
  assert.equal(nextAttendanceMilestone(7)?.days, 14);
  assert.equal(nextAttendanceMilestone(27)?.days, 28);
  assert.equal(nextAttendanceMilestone(28), null);
});

test("진행 상황: 남은 일수와 다음 단계까지 남은 날", () => {
  assert.deepEqual(attendanceProgress(10), {
    attendedDays: 10,
    earnedDays: 1,
    remainingDays: 4,
    next: { days: 14, grantDays: 1 },
    daysToNext: 4,
  });
  assert.deepEqual(attendanceProgress(28), {
    attendedDays: 28,
    earnedDays: 5,
    remainingDays: 0,
    next: null,
    daysToNext: null,
  });
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
