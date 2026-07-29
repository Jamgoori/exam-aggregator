import { test } from "node:test";
import assert from "node:assert/strict";
import {
  spreadResumeDueDates,
  RESUME_SPREAD_PER_DAY,
  RESUME_SPREAD_MAX_DAYS,
} from "./review-resume";
import { srsDayIndex } from "./srs";

// 여기가 무너지면 "과목을 다시 켰더니 오늘 400문항"이 된다. 사용자는 그걸 버그로
// 읽고, 큐 우선순위(연체순)까지 그 과목이 독점해 다른 과목이 몇 주간 안 나온다.

const NOW = new Date("2026-03-10T05:00:00+09:00");
const TODAY = srsDayIndex(NOW);

function dayOffsets(dates: Date[]): number[] {
  return dates.map((d) => srsDayIndex(d) - TODAY);
}

test("하루 몫 이하면 전부 오늘", () => {
  const dates = spreadResumeDueDates(RESUME_SPREAD_PER_DAY, NOW);
  assert.deepEqual(new Set(dayOffsets(dates)), new Set([0]));
});

test("하루 몫씩 다음 날로 넘어간다", () => {
  const offsets = dayOffsets(spreadResumeDueDates(25, NOW, { perDay: 10 }));
  assert.equal(offsets.length, 25);
  assert.equal(offsets.filter((o) => o === 0).length, 10);
  assert.equal(offsets.filter((o) => o === 1).length, 10);
  assert.equal(offsets.filter((o) => o === 2).length, 5);
});

test("문항이 많으면 하루 몫을 늘려서라도 기간 안에 넣는다 (마지막 날 몰아넣기 금지)", () => {
  const offsets = dayOffsets(spreadResumeDueDates(1000, NOW));
  assert.equal(Math.max(...offsets), RESUME_SPREAD_MAX_DAYS - 1);
  // 어느 하루도 복습 하루 상한의 두 배(=40)를 넘지 않는 선에서 고르게 퍼진다.
  const perDay = new Map<number, number>();
  for (const o of offsets) perDay.set(o, (perDay.get(o) ?? 0) + 1);
  assert.ok(Math.max(...perDay.values()) <= 40);
});

test("첫날 몫은 오늘(=지금 바로 풀 수 있음)로 예약된다", () => {
  const [first] = spreadResumeDueDates(3, NOW);
  assert.ok(first.getTime() <= NOW.getTime(), "오늘 04:00은 이미 지난 시각이어야 한다");
});

test("0개·음수는 빈 배열", () => {
  assert.deepEqual(spreadResumeDueDates(0, NOW), []);
  assert.deepEqual(spreadResumeDueDates(-5, NOW), []);
});
