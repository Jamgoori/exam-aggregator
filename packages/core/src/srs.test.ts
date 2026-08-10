import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fuzzInterval,
  isLeechTrigger,
  nextSrs,
  SRS_LEECH_THRESHOLD,
  srsDayIndex,
  srsDueAt,
  srsGuessed,
  srsStateFromRow,
  SRS_FUZZ_MIN_DAYS,
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

test("첫 오답: 그날 안에 재확인, ease·lapses는 건드리지 않는다", () => {
  const { state, dueAt } = nextSrs(SRS_INITIAL, false, kst("2026-03-02T14:00:00"));
  assert.equal(state.intervalDays, 1);
  assert.equal(state.reps, 0);
  // 처음 틀린 건 "복습하다 무너진 것"이 아니므로 페널티 없음.
  assert.equal(state.ease, SRS_INITIAL.ease);
  assert.equal(state.lapses, 0);
  // 내일이 아니라 몇 시간 뒤 — 망각이 가장 빠른 구간을 놓치지 않으려는 것.
  assert.equal(dueAt.toISOString(), kst("2026-03-02T17:00:00").toISOString());
});

test("재확인을 통과하면 같은 날이라도 1일 → 3일로 출발한다", () => {
  // 여기가 막히면 "그날 안에 다시 만나기"가 통째로 죽는다. reps 0(재확인 중)은
  // 하루 1회 규칙에서 빼는 이유가 이것이다.
  const lapsed = nextSrs(SRS_INITIAL, false, kst("2026-03-02T14:00:00"));
  assert.equal(lapsed.state.reps, 0);

  const recheck = nextSrs(
    lapsed.state,
    true,
    kst("2026-03-02T18:00:00"),
    kst("2026-03-02T14:00:00"),
  );
  assert.equal(recheck.state.reps, 1);
  assert.equal(recheck.state.intervalDays, 1);
  assert.equal(recheck.dueAt.toISOString(), kst("2026-03-03T04:00:00").toISOString());

  // 재확인을 통과한 뒤에는 다시 하루 1회 규칙이 걸린다(연타로 간격 불리기 방지).
  const again = nextSrs(
    recheck.state,
    true,
    kst("2026-03-02T21:00:00"),
    kst("2026-03-02T18:00:00"),
  );
  assert.deepEqual(again.state, recheck.state);
});

test("찍었어요: 점수는 그대로 두고 스케줄만 붙잡는다", () => {
  // 4지선다는 모르고도 25%가 맞는다. 그걸 유지력으로 인정하면 모르는 문항이
  // "아는 문제"로 분류돼 큐에서 빠져나간다.
  const state: SrsState = { intervalDays: 3, ease: 2.5, reps: 2, lapses: 1 };
  const { state: next, dueAt } = srsGuessed(state, kst("2026-03-02T14:00:00"));

  // ease를 깎거나 lapses를 올리지는 않는다 — 틀린 게 아니라 "인정 안 함"이다.
  assert.deepEqual(next, state);
  assert.equal(dueAt.toISOString(), kst("2026-03-02T17:00:00").toISOString());
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
  // 첫 오답은 그날 안에 재확인부터 한다(내일이 아니라 몇 시간 뒤).
  assert.equal(dayOf(due.dueAt), 0);

  // 예약된 날마다 정오에 풀었다고 보고 굴린다.
  const solveAt = (at: Date) => new Date(at.getTime() + 8 * 60 * 60 * 1000);
  const schedule: number[] = [];
  for (let i = 0; i < 3; i++) {
    due = nextSrs(state, true, solveAt(due.dueAt));
    state = due.state;
    schedule.push(dayOf(due.dueAt));
  }

  // 재확인 → 1일 → 3일 → ×ease. 재확인 단계가 붙으면서 예전(2,5,13)보다 오히려
  // 앞당겨졌다 — 체험 안에 회차를 더 보여준다.
  assert.deepEqual(schedule, [1, 4, 12]);
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

test("같은 날 다시 맞히면 간격이 벌어지지 않는다(섞어풀기 연타 방지)", () => {
  // 섞어풀기는 쿨다운이 없어 같은 문항을 하루에 몇 번이고 낼 수 있다. 그때마다
  // reps가 올라가면 1일 → 3일 → 8일이 하루 만에 지나가, 열심히 푼 사용자일수록
  // 복습 큐가 비는 역설이 생긴다.
  const state = nextSrs(SRS_INITIAL, false, kst("2026-03-02T14:00:00")).state;

  const morning = nextSrs(state, true, kst("2026-03-03T09:00:00"));
  assert.equal(morning.state.intervalDays, 1);
  assert.equal(morning.state.reps, 1);

  // 같은 날 오후에 또 맞혀도 상태·due가 그대로여야 한다.
  const afternoon = nextSrs(
    morning.state,
    true,
    kst("2026-03-03T15:00:00"),
    kst("2026-03-03T09:00:00"),
  );
  assert.deepEqual(afternoon.state, morning.state);
  assert.equal(afternoon.dueAt.toISOString(), morning.dueAt.toISOString());

  // 다음 날 맞히면 정상적으로 벌어진다.
  const nextDay = nextSrs(
    afternoon.state,
    true,
    kst("2026-03-04T09:00:00"),
    kst("2026-03-03T15:00:00"),
  );
  assert.equal(nextDay.state.intervalDays, 3);
  assert.equal(nextDay.state.reps, 2);
});

test("같은 날이라도 틀린 것은 언제나 반영한다", () => {
  // 방금 맞힌 문항을 곧바로 틀렸다면 그게 진짜 신호다 — 여기서 막으면 안 된다.
  let state = nextSrs(SRS_INITIAL, false, kst("2026-03-02T14:00:00")).state;
  state = nextSrs(state, true, kst("2026-03-03T09:00:00")).state;
  state = nextSrs(state, true, kst("2026-03-04T09:00:00")).state;
  const easeBefore = state.ease;

  const lapsed = nextSrs(state, false, kst("2026-03-04T15:00:00"), kst("2026-03-04T09:00:00"));
  assert.equal(lapsed.state.intervalDays, 1);
  assert.equal(lapsed.state.reps, 0);
  assert.equal(lapsed.state.lapses, 1);
  assert.ok(lapsed.state.ease < easeBefore);
});

test("하루 1회 규칙도 KST 04:00 경계를 따른다", () => {
  // 3/3 01:00은 아직 3/2의 "복습 하루"다. 밤새 이어 푸는 사람이 자정을 넘겼다고
  // 간격을 한 번 더 벌리면 안 된다.
  const state = { intervalDays: 3, ease: 2.5, reps: 2, lapses: 0 };
  const held = nextSrs(state, true, kst("2026-03-03T01:00:00"), kst("2026-03-02T22:00:00"));
  assert.deepEqual(held.state, state);

  // 04:00을 넘기면 새 하루라 정상 반영된다.
  const advanced = nextSrs(state, true, kst("2026-03-03T05:00:00"), kst("2026-03-02T22:00:00"));
  assert.equal(advanced.state.reps, 3);
});

test("예약이 없던 행(마이그레이션 전)은 같은 날이어도 정상 계산한다", () => {
  // intervalDays 0 = 되돌릴 스케줄이 없는 상태. 여기서 붙잡으면 due가 영영 안 잡힌다.
  const { state, dueAt } = nextSrs(
    SRS_INITIAL,
    true,
    kst("2026-03-03T15:00:00"),
    kst("2026-03-03T09:00:00"),
  );
  assert.equal(state.reps, 1);
  assert.equal(state.intervalDays, 1);
  assert.equal(dueAt.toISOString(), kst("2026-03-04T04:00:00").toISOString());
});

test("여덟 번 무너지면 leech로 접는다(Anki 기본값)", () => {
  let state: SrsState = { intervalDays: 3, ease: 2.0, reps: 2, lapses: 6 };

  const seventh = nextSrs(state, false, kst("2026-03-02T09:00:00"));
  assert.equal(seventh.state.lapses, 7);
  assert.ok(!seventh.leech, "7번째는 아직 아니다");
  state = seventh.state;

  const eighth = nextSrs(state, false, kst("2026-03-03T09:00:00"));
  assert.equal(eighth.state.lapses, SRS_LEECH_THRESHOLD);
  assert.equal(eighth.leech, true);
});

test("다시 넣은 뒤에는 기준의 절반마다 다시 접힌다", () => {
  // Anki와 같은 재판정 간격(8 → 12 → 16). 매번 접히면 되살리는 의미가 없고,
  // 다시는 안 접히면 같은 문제가 또 큐를 먹는다.
  assert.equal(isLeechTrigger(7), false);
  assert.equal(isLeechTrigger(8), true);
  assert.equal(isLeechTrigger(9), false);
  assert.equal(isLeechTrigger(11), false);
  assert.equal(isLeechTrigger(12), true);
  assert.equal(isLeechTrigger(16), true);
});

test("맞힌 채점은 leech 판정을 건드리지 않는다", () => {
  const state: SrsState = { intervalDays: 3, ease: 1.5, reps: 2, lapses: 8 };
  const { leech } = nextSrs(state, true, kst("2026-03-02T09:00:00"));
  assert.ok(!leech);
});

test("첫 오답은 lapses가 0이라 접히지 않는다", () => {
  const { leech, state } = nextSrs(SRS_INITIAL, false, kst("2026-03-02T09:00:00"));
  assert.equal(state.lapses, 0);
  assert.ok(!leech);
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

// ── 예정일 밖에서 들어온 채점 (회독·섞어풀기) ───────────────────────────────
//
// 공시생의 기본 학습 방식은 문제지 회독이라, 복습 예정일과 무관하게 같은 문항이
// 다시 채점된다. 그걸 예정된 복습과 똑같이 처리하면 회독을 열심히 할수록 스케줄이
// 망가진다 — 맞히면 간격이 뻥튀기되고, 틀리면 멀쩡한 문항이 리셋되고 leech로 접힌다.

const DAY_MS = 24 * 60 * 60 * 1000;
function daysFrom(base: Date, n: number): Date {
  return new Date(base.getTime() + n * DAY_MS);
}

// 간격 60일 · ease 2.5 로 잘 익은 문항. 아래 테스트들이 공유한다.
const MATURE: SrsState = { intervalDays: 60, ease: 2.5, reps: 5, lapses: 0 };

test("예정일에 맞히면 예전 그대로 × ease", () => {
  const now = kst("2026-03-10T09:00:00");
  const { state } = nextSrs(MATURE, true, now, daysFrom(now, -60), { dueAt: now });
  assert.equal(state.intervalDays, Math.round(60 * 2.5));
});

test("예정일 한참 전에 회독으로 맞히면 간격을 늘리지 않는다", () => {
  // 62일 뒤에 보라고 잡아둔 문항을 6일 만에 맞힌 건 6일치 기억이다. 예전에는
  // 이걸 60 → 150으로 인정해, 회독하는 사용자의 문항이 큐에서 조용히 사라졌다.
  const now = kst("2026-03-10T09:00:00");
  const { state } = nextSrs(MATURE, true, now, daysFrom(now, -6), {
    dueAt: daysFrom(now, 54),
  });
  // 6일치 증거가 감당하는 간격은 6 × 2.5 = 15일뿐이라 이미 배정된 60일을 늘릴
  // 근거가 없다. 줄이지도 않는다 — 맞힌 건 사실이다.
  assert.equal(state.intervalDays, 60);
});

test("예정일이 지났어도 실제로 버틴 만큼만 인정한다", () => {
  // 밀린 복습 정리·찍었어요·과목 재개는 last_answered_at 은 그대로 두고 due 만
  // 앞으로 당긴다. 그때 "예정일이 됐으니 만점"으로 치면 2일 만에 60 → 150이 된다.
  const now = kst("2026-03-10T09:00:00");
  const { state } = nextSrs(MATURE, true, now, daysFrom(now, -2), { dueAt: now });
  // 2일치 증거 = 5일. 이미 60일이 배정돼 있으니 그대로 둔다.
  assert.equal(state.intervalDays, 60);
});

test("조기 정답이 반복돼도 간격이 복리로 불어나지 않는다", () => {
  // 회독하는 사용자는 예정일과 무관하게 같은 문항을 매일 다시 채점한다. 회차마다
  // 조금씩(1 + 1.5 × 1/60 = 1.025배) 붙는 걸 그대로 두면 20일 만에 60 → 98이 되고,
  // due는 늘 "오늘 + 간격"이라 복습일이 그만큼 계속 미래로 밀린다. 성실히 회독할수록
  // 복습 큐가 비는 역설이 여기서 나왔다.
  let state = MATURE;
  let lastGradedAt = kst("2026-03-10T09:00:00");

  for (let i = 1; i <= 20; i++) {
    const now = daysFrom(lastGradedAt, 1);
    const result = nextSrs(state, true, now, lastGradedAt, {
      dueAt: daysFrom(lastGradedAt, MATURE.intervalDays),
    });
    state = result.state;
    lastGradedAt = now;
  }

  assert.equal(state.intervalDays, MATURE.intervalDays);
});

test("예정일 근처에서 맞히면 거의 전부 인정한다", () => {
  // 상한이 조기 정답만 건드려야 한다 — 하루 이틀 일찍 푼 것까지 깎으면
  // "제날짜에 풀어도 간격이 안 늘어난다"가 된다.
  const now = kst("2026-03-10T09:00:00");
  const { state } = nextSrs(MATURE, true, now, daysFrom(now, -58), {
    dueAt: daysFrom(now, 2),
  });
  // 58일치 증거 = 145일. 곱셈 결과(60 × (1 + 1.5 × 58/60) = 147)를 살짝 깎는다.
  assert.equal(state.intervalDays, 145);
});

test("예정일 전에 끌려 나와 틀린 것은 반감만 하고 lapse를 세지 않는다", () => {
  const now = kst("2026-03-10T09:00:00");
  const early = nextSrs(MATURE, false, now, daysFrom(now, -6), {
    dueAt: daysFrom(now, 54),
  });

  assert.equal(early.state.intervalDays, 30); // 리셋(1일)이 아니라 반감
  assert.equal(early.state.lapses, 0); // leech 진행 없음 — 스케줄의 실패가 아니다
  assert.ok(!early.leech);
  assert.equal(early.state.reps, 5); // 진도 유지(지우면 다음 정답이 1일로 되돌아간다)
  assert.ok(early.state.ease < MATURE.ease); // 페널티는 절반만
  // 그래도 오늘 안에 한 번 더 만난다.
  assert.equal(early.dueAt.toISOString(), kst("2026-03-10T12:00:00").toISOString());
});

test("그 재확인에서 또 틀리면 그때는 정상 lapse", () => {
  // 완화는 "예정일 전"에만 준다. 재확인 예약(3시간 뒤)이 지난 뒤의 오답은
  // 예정일이 된 문항을 틀린 것이라 리셋·lapse가 맞다.
  const now = kst("2026-03-10T09:00:00");
  const early = nextSrs(MATURE, false, now, daysFrom(now, -6), {
    dueAt: daysFrom(now, 54),
  });

  const again = nextSrs(early.state, false, kst("2026-03-10T15:00:00"), now, {
    dueAt: early.dueAt,
  });
  assert.equal(again.state.intervalDays, 1);
  assert.equal(again.state.reps, 0);
  assert.equal(again.state.lapses, 1);
});

test("간격 1일짜리는 조기 완화 대상이 아니다", () => {
  // 반감해도 1일이라 의미가 없고, 재확인 중인 문항을 완화하면 lapse가 영영 안 쌓여
  // leech 판정이 죽는다.
  const now = kst("2026-03-10T09:00:00");
  const state: SrsState = { intervalDays: 1, ease: 2.5, reps: 1, lapses: 3 };
  const { state: next } = nextSrs(state, false, now, daysFrom(now, -1), {
    dueAt: daysFrom(now, 1),
  });
  assert.equal(next.lapses, 4);
  assert.equal(next.reps, 0);
});

test("dueAt을 안 주면 예전 동작 그대로(마이그레이션 전·승격 직후)", () => {
  const now = kst("2026-03-10T09:00:00");
  const { state } = nextSrs(MATURE, false, now, daysFrom(now, -1));
  assert.equal(state.intervalDays, 1);
  assert.equal(state.lapses, 1);
});

// ── 간격 흔들기(fuzz) ────────────────────────────────────────────────────────

test("fuzz: rand를 안 주면 흔들지 않는다(기본은 결정적)", () => {
  assert.equal(fuzzInterval(20), 20);
  assert.equal(fuzzInterval(200), 200);
});

test("fuzz: 학습 단계(4일 미만)는 흔들지 않는다", () => {
  assert.equal(fuzzInterval(1, () => 0), 1);
  assert.equal(fuzzInterval(3, () => 1), 3);
  // 하한에 걸려 학습 단계로 되돌아가지도 않는다.
  assert.equal(fuzzInterval(4, () => 0), SRS_FUZZ_MIN_DAYS);
});

test("fuzz: ±10% 안에서만 움직인다", () => {
  assert.equal(fuzzInterval(20, () => 0.5), 20);
  assert.equal(fuzzInterval(20, () => 0), 18);
  assert.equal(fuzzInterval(20, () => 1), 22);
  // 상한을 넘기지 않는다.
  assert.equal(fuzzInterval(SRS_MAX_INTERVAL_DAYS, () => 1), SRS_MAX_INTERVAL_DAYS);
});

test("fuzz는 nextSrs의 곱셈 단계에만 걸린다", () => {
  const now = kst("2026-03-10T09:00:00");
  const { state } = nextSrs(MATURE, true, now, daysFrom(now, -60), {
    dueAt: now,
    fuzz: () => 1,
  });
  assert.equal(state.intervalDays, 165); // 150 + 10%
});

// ── ease ────────────────────────────────────────────────────────────────────

test("정답으로는 ease가 기본값보다 후해지지 않는다", () => {
  // 예전에는 상한이 2.8이라 세 번만 맞히면 상한에 붙었다. 맞다/틀리다 2단계
  // 채점에서 "겨우 맞힌 것"과 "확실히 아는 것"을 구분할 수 없으므로 낮은 쪽으로.
  assert.equal(SRS_MAX_EASE, SRS_INITIAL.ease);

  let state: SrsState = { ...SRS_INITIAL, reps: 3, intervalDays: 8 };
  for (let i = 0; i < 10; i++) {
    state = nextSrs(state, true, kst("2026-03-02T09:00:00")).state;
  }
  assert.equal(state.ease, SRS_INITIAL.ease);
});

test("무너져 깎인 ease는 정답으로 되돌아온다", () => {
  // 보너스를 0으로 없애면 한 번 깎인 문항이 영원히 촘촘하게만 나온다.
  const state: SrsState = { intervalDays: 8, ease: 1.8, reps: 3, lapses: 2 };
  const { state: next } = nextSrs(state, true, kst("2026-03-02T09:00:00"));
  assert.ok(next.ease > state.ease);
  assert.ok(next.ease <= SRS_MAX_EASE);
});

test("srsStateFromRow: 컬럼이 없으면 초기 상태로 떨어진다(마이그레이션 전 대비)", () => {
  assert.deepEqual(srsStateFromRow({}), SRS_INITIAL);
  assert.deepEqual(srsStateFromRow({ srs_interval_days: null, srs_ease: null }), SRS_INITIAL);
  assert.deepEqual(
    srsStateFromRow({ srs_interval_days: 8, srs_ease: 2.6, srs_reps: 3, srs_lapses: 1 }),
    { intervalDays: 8, ease: 2.6, reps: 3, lapses: 1 },
  );
});
