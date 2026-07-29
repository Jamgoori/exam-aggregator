import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextSrs,
  srsDayIndex,
  srsDueAt,
  srsStateFromRow,
  SRS_INITIAL,
  SRS_MAX_EASE,
  SRS_MAX_INTERVAL_DAYS,
  SRS_MIN_EASE,
  type SrsState,
} from "./srs";

// 복습 큐에 "언제 다시 나오는가"가 전부 이 함수에서 나온다. 여기가 틀리면 사용자마다
// 복습일이 조용히 어긋나는데, 화면에서는 티가 안 나고 몇 주 뒤에야 드러난다.

// KST 기준 시각을 UTC Date로. (KST = UTC+9)
function kst(iso: string): Date {
  return new Date(`${iso}+09:00`);
}

test("첫 오답: 1일 뒤로 예약, ease·lapses는 건드리지 않는다", () => {
  const { state, dueAt } = nextSrs(SRS_INITIAL, false, kst("2026-03-02T14:00:00"));
  assert.equal(state.intervalDays, 1);
  assert.equal(state.reps, 0);
  // 처음 틀린 건 "복습하다 무너진 것"이 아니므로 페널티 없음.
  assert.equal(state.ease, SRS_INITIAL.ease);
  assert.equal(state.lapses, 0);
  assert.equal(dueAt.toISOString(), kst("2026-03-03T04:00:00").toISOString());
});

test("맞히면 1일 → 3일 → 직전 간격 × ease 로 벌어진다", () => {
  let state: SrsState = nextSrs(SRS_INITIAL, false, kst("2026-03-02T14:00:00")).state;

  const first = nextSrs(state, true, kst("2026-03-03T09:00:00"));
  assert.equal(first.state.intervalDays, 1);
  assert.equal(first.state.reps, 1);
  state = first.state;

  const second = nextSrs(state, true, kst("2026-03-04T09:00:00"));
  assert.equal(second.state.intervalDays, 3);
  assert.equal(second.state.reps, 2);
  state = second.state;

  // reps 3부터 곱셈. 간격 계산엔 갱신 전 ease(2.5 + 0.1 + 0.1 = 2.7이 아니라 2.6)를 쓴다.
  const third = nextSrs(state, true, kst("2026-03-07T09:00:00"));
  assert.equal(third.state.intervalDays, Math.round(3 * state.ease));
  assert.equal(third.state.reps, 3);
});

test("2주 체험 안에 4회차까지 돈다", () => {
  // 체험 길이를 2주로 정한 근거. day0에 틀린 문항이 day13에 4회차로 돌아와야,
  // 사용자가 "간격이 벌어진다"를 체험 중에 한 번은 눈으로 본다.
  const day0 = kst("2026-03-02T14:00:00");
  const dayOf = (d: Date) => srsDayIndex(d) - srsDayIndex(day0);

  let state = SRS_INITIAL;
  let due = nextSrs(state, false, day0);
  state = due.state;
  assert.equal(dayOf(due.dueAt), 1);

  // 예약된 날마다 정오에 풀었다고 보고 굴린다.
  const solveAt = (at: Date) => new Date(at.getTime() + 8 * 60 * 60 * 1000);
  const schedule: number[] = [];
  for (let i = 0; i < 3; i++) {
    due = nextSrs(state, true, solveAt(due.dueAt));
    state = due.state;
    schedule.push(dayOf(due.dueAt));
  }

  assert.deepEqual(schedule, [2, 5, 13]);
  assert.ok(schedule[schedule.length - 1] <= 14, "마지막 회차가 체험 기간 안에 들어와야 한다");
});

test("맞히다 틀리면 간격 1일로 리셋 + ease 하락 + lapses 증가", () => {
  let state = nextSrs(SRS_INITIAL, false, kst("2026-03-02T14:00:00")).state;
  state = nextSrs(state, true, kst("2026-03-03T09:00:00")).state;
  state = nextSrs(state, true, kst("2026-03-04T09:00:00")).state;
  const easeBefore = state.ease;

  const lapsed = nextSrs(state, false, kst("2026-03-07T09:00:00"));
  assert.equal(lapsed.state.intervalDays, 1);
  assert.equal(lapsed.state.reps, 0);
  assert.equal(lapsed.state.lapses, 1);
  assert.ok(lapsed.state.ease < easeBefore);
});

test("ease는 상·하한을 넘지 않는다", () => {
  let state: SrsState = { ...SRS_INITIAL, reps: 1, intervalDays: 1 };
  for (let i = 0; i < 30; i++) state = nextSrs(state, true, kst("2026-03-02T09:00:00")).state;
  assert.equal(state.ease, SRS_MAX_EASE);

  for (let i = 0; i < 30; i++) state = nextSrs(state, false, kst("2026-03-02T09:00:00")).state;
  assert.equal(state.ease, SRS_MIN_EASE);
});

test("간격은 상한(180일)을 넘지 않는다", () => {
  const state: SrsState = { intervalDays: 170, ease: 2.5, reps: 9, lapses: 0 };
  const { state: next } = nextSrs(state, true, kst("2026-03-02T09:00:00"));
  assert.equal(next.intervalDays, SRS_MAX_INTERVAL_DAYS);
});

test("하루 경계는 KST 04:00 — 새벽에 푼 건 전날로 친다", () => {
  // 3/3 02:00에 푼 사람의 "내일"은 3/4가 아니라 그날 아침 4시다.
  assert.equal(
    srsDueAt(kst("2026-03-03T02:00:00"), 1).toISOString(),
    kst("2026-03-03T04:00:00").toISOString(),
  );
  // 04:00을 넘긴 뒤로는 다음 날 04:00.
  assert.equal(
    srsDueAt(kst("2026-03-03T05:00:00"), 1).toISOString(),
    kst("2026-03-04T04:00:00").toISOString(),
  );
});

test("srsStateFromRow: 컬럼이 없으면 초기 상태로 떨어진다(마이그레이션 전 대비)", () => {
  assert.deepEqual(srsStateFromRow({}), SRS_INITIAL);
  assert.deepEqual(srsStateFromRow({ srs_interval_days: null, srs_ease: null }), SRS_INITIAL);
  assert.deepEqual(
    srsStateFromRow({ srs_interval_days: 8, srs_ease: 2.6, srs_reps: 3, srs_lapses: 1 }),
    { intervalDays: 8, ease: 2.6, reps: 3, lapses: 1 },
  );
});
