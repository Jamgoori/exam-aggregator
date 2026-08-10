import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDueQueue,
  countBySubject,
  forecastDueByDay,
  newItemsForLimit,
  normalizeDailyLimit,
  paperCapForLimit,
  recentItemsForNew,
  DUE_QUEUE_LIMIT,
  NEW_QUEUE_LIMIT,
  SUBJECT_MIN_SLOTS,
  type DueCandidate,
  type PendingCandidate,
} from "./review-queue";

// 섞어풀기(무작위)와 복습(우선순위)의 차이가 전부 여기서 갈린다. 여기가 무너지면
// 사용자는 "매번 비슷한 문제만 나온다" 또는 "틀린 문제가 영영 안 나온다"를 겪는데,
// 둘 다 몇 주 지나서야 드러난다.

const NOW = new Date("2026-03-10T05:00:00+09:00");

function cand(overrides: Partial<DueCandidate> & { dueAt: string }): DueCandidate {
  return {
    paperId: "p1",
    questionNumber: 1,
    subjectId: "korean",
    lapses: 0,
    ...overrides,
  };
}

// NOW 기준 offset일 뒤 04:00(KST)의 ISO. srs.ts와 같은 하루 경계를 쓴다.
const TODAY_0400 = new Date("2026-03-10T04:00:00+09:00").getTime();
function dueDay(offset: number): string {
  return new Date(TODAY_0400 + offset * 24 * 60 * 60 * 1000).toISOString();
}

test("아직 due가 안 된 문항은 오늘 큐에 안 들어온다", () => {
  const queue = buildDueQueue(
    [cand({ dueAt: dueDay(0) }), cand({ questionNumber: 2, dueAt: dueDay(3) })],
    [],
    NOW,
  );
  assert.equal(queue.length, 1);
  assert.equal(queue[0].questionNumber, 1);
});

test("연체일 + 무너진 횟수 점수 순으로 고른다", () => {
  const queue = buildDueQueue(
    [
      // 0점
      cand({ questionNumber: 1, dueAt: dueDay(0), lapses: 0 }),
      // 5점
      cand({ questionNumber: 2, dueAt: dueDay(-5), lapses: 0 }),
      // 12점 — 연체는 오늘이지만 네 번 무너졌다.
      cand({ questionNumber: 3, dueAt: dueDay(0), lapses: 4 }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(
    queue.map((q) => q.questionNumber),
    [3, 2, 1],
  );
});

test("연체일에 상한이 있어 상습범이 묻히지 않는다", () => {
  // 예전 규칙(연체순)이라면 40일 밀린 1번이 무조건 앞이었다. 그게 1회독 백로그가
  // 쌓인 사용자에게서 "자주 틀리는 문제 먼저"를 죽이던 자리다.
  const queue = buildDueQueue(
    [
      cand({ questionNumber: 1, dueAt: dueDay(-40), lapses: 0 }),
      cand({ questionNumber: 2, dueAt: dueDay(-1), lapses: 5 }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(
    // 1번은 상한에 걸려 14점, 2번은 1 + 15 = 16점.
    queue.map((q) => q.questionNumber),
    [2, 1],
  );
});

test("점수가 같으면 오래 연체된 것 먼저", () => {
  const queue = buildDueQueue(
    [
      // 3 + 3 = 6점
      cand({ questionNumber: 1, dueAt: dueDay(-3), lapses: 1 }),
      // 6 + 0 = 6점
      cand({ questionNumber: 2, dueAt: dueDay(-6), lapses: 0 }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(
    queue.map((q) => q.questionNumber),
    [2, 1],
  );
});

test("점수 상한을 넘긴 문항끼리는 연체 순서를 유지한다", () => {
  // 둘 다 14점이라 점수로는 못 가른다. 그래도 순서가 흔들리면 안 된다.
  const queue = buildDueQueue(
    [
      cand({ questionNumber: 1, dueAt: dueDay(-20), lapses: 0 }),
      cand({ questionNumber: 2, dueAt: dueDay(-60), lapses: 0 }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(
    queue.map((q) => q.questionNumber),
    [2, 1],
  );
});

test("상한을 넘으면 우선순위 높은 것만 남는다(나머지는 내일 큐 앞으로)", () => {
  const many = Array.from({ length: DUE_QUEUE_LIMIT + 15 }, (_, i) =>
    cand({ questionNumber: i + 1, dueAt: dueDay(-i) }),
  );
  const queue = buildDueQueue(many, [], NOW);
  assert.equal(queue.length, DUE_QUEUE_LIMIT);
  // 가장 오래 연체된 것(i가 클수록 과거)이 들어와야 한다.
  const numbers = new Set(queue.map((q) => q.questionNumber));
  assert.ok(numbers.has(DUE_QUEUE_LIMIT + 15));
  assert.ok(!numbers.has(1));
});

test("같은 과목이 연달아 나오지 않게 섞는다", () => {
  const items = [
    ...Array.from({ length: 5 }, (_, i) =>
      cand({ paperId: "k", questionNumber: i + 1, subjectId: "korean", dueAt: dueDay(-1) }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      cand({ paperId: "h", questionNumber: i + 1, subjectId: "history", dueAt: dueDay(-1) }),
    ),
  ];
  const queue = buildDueQueue(items, [], NOW);
  assert.equal(queue.length, 10);

  let sameNeighbors = 0;
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].subjectId === queue[i - 1].subjectId) sameNeighbors++;
  }
  assert.equal(sameNeighbors, 0);
});

test("과목이 하나뿐이면 우선순위 순서를 그대로 유지한다", () => {
  const queue = buildDueQueue(
    [
      cand({ questionNumber: 1, dueAt: dueDay(0) }),
      cand({ questionNumber: 2, dueAt: dueDay(-2) }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(
    queue.map((q) => q.questionNumber),
    [2, 1],
  );
});

test("과목 수가 안 맞아도 문항을 잃지 않는다", () => {
  const items = [
    ...Array.from({ length: 7 }, (_, i) =>
      cand({ paperId: "k", questionNumber: i + 1, subjectId: "korean", dueAt: dueDay(-1) }),
    ),
    cand({ paperId: "h", questionNumber: 1, subjectId: "history", dueAt: dueDay(-1) }),
    cand({ paperId: "e", questionNumber: 1, subjectId: null, dueAt: dueDay(-1) }),
  ];
  const queue = buildDueQueue(items, [], NOW);
  assert.equal(queue.length, 9);
});

function pend(overrides: Partial<PendingCandidate> = {}): PendingCandidate {
  return {
    paperId: "p1",
    questionNumber: 1,
    subjectId: "korean",
    wrongCount: 1,
    lastAnsweredAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

test("복습이 상한을 다 먹으면 신규는 하나도 안 들어온다", () => {
  // 밀린 걸 먼저 소화하는 게 맞다. 여기서 신규를 끼워 넣으면 적체가 영영 안 준다.
  const due = Array.from({ length: DUE_QUEUE_LIMIT }, (_, i) =>
    cand({ questionNumber: i + 1, dueAt: dueDay(-1) }),
  );
  const pending = Array.from({ length: 50 }, (_, i) =>
    pend({ paperId: "new", questionNumber: i + 1 }),
  );

  const queue = buildDueQueue(due, pending, NOW);
  assert.equal(queue.length, DUE_QUEUE_LIMIT);
  assert.equal(queue.filter((q) => q.isNew).length, 0);
});

test("남는 자리가 있어도 신규는 하루 몫까지만 태운다", () => {
  // 1회독 중 하루 80개씩 틀려도 큐에 들어오는 새 문항은 NEW_QUEUE_LIMIT개뿐이다.
  const pending = Array.from({ length: 80 }, (_, i) =>
    pend({ paperId: "new", questionNumber: i + 1 }),
  );

  const queue = buildDueQueue([], pending, NOW);
  assert.equal(queue.length, NEW_QUEUE_LIMIT);
  assert.ok(queue.every((q) => q.isNew));
  // 승격된 문항은 즉시 오늘 due — 세션에서 채점되면 거기서부터 간격이 붙는다.
  assert.ok(queue.every((q) => q.dueAt <= NOW.toISOString()));
});

test("복습 5개 + 신규 10개 = 15개 (상한 20을 억지로 채우지 않는다)", () => {
  const due = Array.from({ length: 5 }, (_, i) =>
    cand({ questionNumber: i + 1, dueAt: dueDay(-1) }),
  );
  const pending = Array.from({ length: 40 }, (_, i) =>
    pend({ paperId: "new", questionNumber: i + 1 }),
  );

  const queue = buildDueQueue(due, pending, NOW);
  assert.equal(queue.length, 15);
  assert.equal(queue.filter((q) => q.isNew).length, NEW_QUEUE_LIMIT);
});

test("신규 승격은 자주 틀린 것 먼저, 같으면 오래 안 본 것 먼저", () => {
  const pending = [
    pend({ questionNumber: 1, wrongCount: 1, lastAnsweredAt: "2026-01-01T00:00:00.000Z" }),
    pend({ questionNumber: 2, wrongCount: 5, lastAnsweredAt: "2026-03-09T00:00:00.000Z" }),
    pend({ questionNumber: 3, wrongCount: 5, lastAnsweredAt: "2026-02-01T00:00:00.000Z" }),
  ];

  const queue = buildDueQueue([], pending, NOW, { newItems: 2 });
  assert.deepEqual(
    queue.map((q) => q.questionNumber),
    // 5회 틀린 둘이 먼저, 그중 오래 안 본 3번이 앞. 1회짜리는 아직 안 태운다.
    [3, 2],
  );
});

test("신규 몫의 일부는 최근에 틀린 문항이 가져간다", () => {
  // 1회독 중인 사용자의 대기 풀은 거의 전부 wrong_count 1 동점이라, 우선순위만
  // 따르면 "가장 오래된 것부터"가 되어 어제 오답이 영영 안 나온다. 조회 창까지
  // 오래된 쪽에 고정돼 있어 후보에 들어오지도 못한다.
  const pending = [
    ...Array.from({ length: 30 }, (_, i) =>
      pend({
        paperId: "old",
        questionNumber: i + 1,
        lastAnsweredAt: "2025-09-01T00:00:00.000Z",
      }),
    ),
    ...Array.from({ length: 30 }, (_, i) =>
      pend({
        paperId: "recent",
        questionNumber: i + 1,
        lastAnsweredAt: "2026-03-09T00:00:00.000Z",
      }),
    ),
  ];

  const queue = buildDueQueue([], pending, NOW, { total: 20, newItems: 10 });
  assert.equal(queue.length, 10);
  // 10 × 0.3 = 3자리는 최근분 몫. 나머지 7은 예전대로 오래된 쪽이 가져간다.
  assert.equal(queue.filter((q) => q.paperId === "recent").length, 3);
  assert.equal(queue.filter((q) => q.paperId === "old").length, 7);
});

test("최근분 몫이 자주 틀린 문항의 자리를 빼앗지는 않는다", () => {
  // 최근분은 몫의 30%뿐이다. 반복해서 무너지는 문항이 우선이라는 판단은 그대로다.
  const pending = [
    ...Array.from({ length: 20 }, (_, i) =>
      pend({
        paperId: "repeat",
        questionNumber: i + 1,
        wrongCount: 4,
        lastAnsweredAt: "2025-09-01T00:00:00.000Z",
      }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      pend({
        paperId: "recent",
        questionNumber: i + 1,
        wrongCount: 1,
        lastAnsweredAt: "2026-03-09T00:00:00.000Z",
      }),
    ),
  ];

  const queue = buildDueQueue([], pending, NOW, { total: 20, newItems: 10 });
  assert.equal(queue.filter((q) => q.paperId === "repeat").length, 7);
});

test("신규 몫이 3개 이하면 쪼개지 않는다", () => {
  // 자리가 몇 개 없을 때 나누면 양쪽 다 제 몫을 못 한다(내림).
  assert.equal(recentItemsForNew(3), 0);
  assert.equal(recentItemsForNew(10), 3);
  assert.equal(recentItemsForNew(20), 6);
  assert.equal(recentItemsForNew(0), 0);
});

test("신규 몫을 0으로 주면 대기 풀은 전혀 안 건드린다", () => {
  const queue = buildDueQueue([], [pend()], NOW, { newItems: 0 });
  assert.deepEqual(queue, []);
});

test("승격된 신규도 과목 섞기에 함께 들어간다", () => {
  const pending = [
    ...Array.from({ length: 3 }, (_, i) =>
      pend({ paperId: "k", questionNumber: i + 1, subjectId: "korean" }),
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      pend({ paperId: "h", questionNumber: i + 1, subjectId: "history" }),
    ),
  ];

  const queue = buildDueQueue([], pending, NOW);
  let sameNeighbors = 0;
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].subjectId === queue[i - 1].subjectId) sameNeighbors++;
  }
  assert.equal(sameNeighbors, 0);
});

test("한 과목이 due를 독점해도 다른 과목이 최소 몫을 받는다", () => {
  // 인터리빙은 "뽑은 것의 순서"만 바꾼다. 뽑기가 점수순뿐이면 행정법 200개짜리
  // 사용자의 큐는 20자리 전부 행정법이고, 국어는 그게 다 빠질 때까지 안 나온다.
  // 행정법 due 100개는 시험지 10장에 흩어져 있다(문제지 상한과 얽히지 않게).
  const items = [
    ...Array.from({ length: 100 }, (_, i) =>
      cand({
        paperId: `a${Math.floor(i / 10)}`,
        questionNumber: i + 1,
        subjectId: "admin",
        dueAt: dueDay(-1),
      }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      cand({ paperId: "k", questionNumber: i + 1, subjectId: "korean", dueAt: dueDay(-1) }),
    ),
  ];

  const queue = buildDueQueue(items, [], NOW, { total: 20, newItems: 0 });
  assert.equal(queue.length, 20);
  assert.equal(queue.filter((q) => q.subjectId === "korean").length, SUBJECT_MIN_SLOTS);
  // 나머지 자리는 예전처럼 위험도 경쟁 — 밀린 과목이 더 많이 나오는 건 맞는 동작이다.
  assert.equal(queue.filter((q) => q.subjectId === "admin").length, 20 - SUBJECT_MIN_SLOTS);
});

test("최소 몫은 하루 총량에 비례한다", () => {
  const items = [
    ...Array.from({ length: 100 }, (_, i) =>
      cand({
        paperId: `a${Math.floor(i / 10)}`,
        questionNumber: i + 1,
        subjectId: "admin",
        dueAt: dueDay(-1),
      }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      cand({
        paperId: `k${Math.floor(i / 10)}`,
        questionNumber: i + 1,
        subjectId: "korean",
        dueAt: dueDay(-1),
      }),
    ),
  ];

  const queue = buildDueQueue(items, [], NOW, { total: 40, newItems: 0 });
  assert.equal(queue.filter((q) => q.subjectId === "korean").length, 4);
});

test("과목 수가 상한보다 많아도 자리를 다 채운다", () => {
  // 최소 몫 × 과목 수가 상한을 넘으면 몫을 줄인다. 여기서 자리를 남기면 큐가 짧아진다.
  const items = Array.from({ length: 25 }, (_, i) =>
    cand({ paperId: `p${i}`, questionNumber: 1, subjectId: `s${i}`, dueAt: dueDay(-1) }),
  );
  const queue = buildDueQueue(items, [], NOW, { total: 20, newItems: 0 });
  assert.equal(queue.length, 20);
  assert.equal(new Set(queue.map((q) => q.subjectId)).size, 20);
});

test("신규 승격도 과목을 번갈아 태운다", () => {
  // 승격 순서는 "자주 틀린 것 먼저"인데 1회독 중에는 전부 동점이라, 그대로 두면
  // 오래된 시험지부터 순서대로 = 신규 10개가 통째로 한 과목이 된다.
  const pending = [
    ...Array.from({ length: 30 }, (_, i) =>
      pend({ paperId: "a", questionNumber: i + 1, subjectId: "admin", wrongCount: 3 }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      pend({ paperId: "k", questionNumber: i + 1, subjectId: "korean", wrongCount: 1 }),
    ),
  ];

  const queue = buildDueQueue([], pending, NOW, { total: 20, newItems: 10 });
  assert.equal(queue.length, 10);
  assert.equal(queue.filter((q) => q.subjectId === "korean").length, 5);
  assert.equal(queue.filter((q) => q.subjectId === "admin").length, 5);
});

test("같은 입력이면 같은 큐가 나온다(배너 숫자 = 세션 문항)", () => {
  // 배너와 세션 생성이 이 함수를 각각 호출한다. 여기서 흔들리면 "20개"라고 띄워
  // 놓고 다른 문항이 나온다.
  const due = [cand({ questionNumber: 1, dueAt: dueDay(-1) })];
  const pending = Array.from({ length: 30 }, (_, i) =>
    pend({ paperId: "new", questionNumber: i + 1, wrongCount: (i % 3) + 1 }),
  );

  assert.deepEqual(buildDueQueue(due, pending, NOW), buildDueQueue(due, pending, NOW));
});

test("하루 문항 수: 목록 밖 값은 기본값으로 떨어진다", () => {
  // DB 값을 그대로 믿으면 "하루 1문항"이나 0으로 스케줄이 사실상 정지한다.
  assert.equal(normalizeDailyLimit(40), 40);
  assert.equal(normalizeDailyLimit(null), DUE_QUEUE_LIMIT);
  assert.equal(normalizeDailyLimit(undefined), DUE_QUEUE_LIMIT);
  assert.equal(normalizeDailyLimit(0), DUE_QUEUE_LIMIT);
  assert.equal(normalizeDailyLimit(-5), DUE_QUEUE_LIMIT);
  assert.equal(normalizeDailyLimit(1000), DUE_QUEUE_LIMIT);
});

test("신규 몫은 하루 총량에 비례한다", () => {
  assert.equal(newItemsForLimit(DUE_QUEUE_LIMIT), NEW_QUEUE_LIMIT);
  assert.equal(newItemsForLimit(40), 20);
  assert.equal(newItemsForLimit(10), 5);
  // 총량을 줄여도 신규가 0이 되면 대기 풀이 영영 안 줄어든다.
  assert.ok(newItemsForLimit(1) >= 1);
});

test("상한을 올리면 신규도 그만큼 더 들어온다", () => {
  const pending = Array.from({ length: 80 }, (_, i) =>
    pend({ paperId: "new", questionNumber: i + 1 }),
  );
  const queue = buildDueQueue([], pending, NOW, {
    total: 40,
    newItems: newItemsForLimit(40),
  });
  assert.equal(queue.length, 20);
});

test("7일 표: 연체분은 오늘 칸으로 접고, 0인 날도 빠지지 않는다", () => {
  const forecast = forecastDueByDay(
    [
      cand({ questionNumber: 1, dueAt: dueDay(-4) }),
      cand({ questionNumber: 2, dueAt: dueDay(0) }),
      cand({ questionNumber: 3, dueAt: dueDay(2) }),
      cand({ questionNumber: 4, dueAt: dueDay(2) }),
      // 표 범위 밖은 세지 않는다.
      cand({ questionNumber: 5, dueAt: dueDay(9) }),
    ],
    NOW,
  );

  assert.equal(forecast.length, 7);
  assert.deepEqual(
    forecast.map((d) => d.count),
    [2, 0, 2, 0, 0, 0, 0],
  );
  // 0인 날이 있다는 것 자체가 유료 스케줄의 증거라 칸을 지우면 안 된다.
  assert.equal(forecast[1].offset, 1);
});

test("7일 표: 상한을 넘긴 연체는 다음 날로 흘러간다", () => {
  // 밀린 50문항 · 하루 20 → 20 / 20 / 10 / 0 ...
  const candidates = Array.from({ length: 50 }, (_, i) =>
    cand({ questionNumber: i + 1, dueAt: dueDay(-3) }),
  );
  const forecast = forecastDueByDay(candidates, NOW, { total: 20, newItems: 0 });

  assert.deepEqual(
    forecast.map((d) => d.count),
    [20, 20, 10, 0, 0, 0, 0],
  );
});

test("7일 표의 오늘 칸은 실제 큐 길이와 같아야 한다", () => {
  // 카드 제목("오늘 복습할 N문항")과 표의 오늘 칸이 어긋나면 안 된다. 밀린 것이
  // 상한을 다 먹는 날(신규 0)과 자리가 남는 날(신규 승격) 양쪽을 확인한다.
  const limits = { total: 20, newItems: newItemsForLimit(20) };
  const pending = Array.from({ length: 40 }, (_, i) =>
    pend({ paperId: "new", questionNumber: i + 1 }),
  );

  for (const overdue of [136, 5, 0]) {
    const candidates = Array.from({ length: overdue }, (_, i) =>
      cand({ questionNumber: i + 1, dueAt: dueDay(-2) }),
    );
    const queue = buildDueQueue(candidates, pending, NOW, limits);
    const forecast = forecastDueByDay(candidates, NOW, {
      ...limits,
      pendingCount: pending.length,
    });
    assert.equal(forecast[0].count, queue.length, `연체 ${overdue}일 때`);
  }
});

test("7일 표: 밀린 것이 상한을 다 먹으면 다음 날 칸도 비지 않는다", () => {
  // "116문항은 내일 이어서"라고 써놓고 표에는 "내일 −"이 뜨던 회귀. 연체분은 날짜가
  // 과거라 내일 칸에 안 잡혔었다.
  const candidates = Array.from({ length: 136 }, (_, i) =>
    cand({ questionNumber: i + 1, dueAt: dueDay(-1) }),
  );
  const forecast = forecastDueByDay(candidates, NOW, { total: 20, newItems: 0 });

  assert.equal(forecast[0].count, 20);
  assert.ok(forecast[1].count > 0, "내일 칸이 비면 안 된다");
});

test("7일 표: 복습이 상한을 다 먹은 날은 신규가 안 들어온다", () => {
  const candidates = Array.from({ length: 60 }, (_, i) =>
    cand({ questionNumber: i + 1, dueAt: dueDay(0) }),
  );
  const forecast = forecastDueByDay(candidates, NOW, {
    total: 20,
    newItems: 10,
    pendingCount: 500,
  });

  // 앞 3일은 밀린 복습이 20을 다 채우고, 4일째부터 신규 몫 10개만 남는다.
  assert.deepEqual(
    forecast.map((d) => d.count),
    [20, 20, 20, 10, 10, 10, 10],
  );
});

test("과목별 분포는 많은 순, 이름 못 찾는 과목은 뺀다", () => {
  const items = [
    cand({ paperId: "k", questionNumber: 1, subjectId: "korean", dueAt: dueDay(0) }),
    cand({ paperId: "k", questionNumber: 2, subjectId: "korean", dueAt: dueDay(0) }),
    cand({ paperId: "h", questionNumber: 1, subjectId: "history", dueAt: dueDay(0) }),
    cand({ paperId: "x", questionNumber: 1, subjectId: null, dueAt: dueDay(0) }),
  ];
  const names: Record<string, string> = { korean: "국어", history: "한국사" };
  const dist = countBySubject(items, (id) => (id ? (names[id] ?? null) : null));

  assert.deepEqual(dist, [
    { subjectId: "korean", name: "국어", count: 2 },
    { subjectId: "history", name: "한국사", count: 1 },
  ]);
});

test("한 문제지가 하루 큐를 다 먹지 않는다", () => {
  // 회독 직후에는 그 시험지 문항이 한꺼번에 due가 된다. 우선순위만 따르면 오늘
  // 20문항이 전부 같은 시험지가 되고, 사용자는 그걸 "복습이 고장 났다"로 읽는다.
  const items = [
    ...Array.from({ length: 40 }, (_, i) =>
      cand({ paperId: "hot", questionNumber: i + 1, subjectId: "korean", dueAt: dueDay(-3) }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      cand({
        paperId: `other${i % 4}`,
        questionNumber: i + 1,
        subjectId: "korean",
        dueAt: dueDay(-1),
      }),
    ),
  ];

  const queue = buildDueQueue(items, [], NOW, { total: 20, newItems: 0 });
  assert.equal(queue.length, 20);
  // 20 × 0.25 = 5자리까지. 더 오래 밀렸어도 한 시험지가 큐를 독점하지는 못한다.
  assert.equal(queue.filter((q) => q.paperId === "hot").length, paperCapForLimit(20));
});

test("다른 문제지가 없으면 상한을 풀고 자리를 채운다", () => {
  // 상한 때문에 큐가 짧아지는 건 편중보다 나쁘다. 오늘 볼 게 20개인데 5개만 주면
  // 나머지 15개는 그냥 밀린다.
  const items = Array.from({ length: 30 }, (_, i) =>
    cand({ paperId: "only", questionNumber: i + 1, dueAt: dueDay(-1) }),
  );
  const queue = buildDueQueue(items, [], NOW, { total: 20, newItems: 0 });
  assert.equal(queue.length, 20);
});

test("같은 과목 안에서도 문제지가 번갈아 나온다", () => {
  // 과목만 섞으면 "국어 5문항"이 전부 같은 시험지에서 연달아 나온다. 사용자에게는
  // 과목이 섞였다는 사실보다 같은 시험지가 이어진다는 사실이 먼저 보인다.
  const items = [
    ...Array.from({ length: 4 }, (_, i) =>
      cand({ paperId: "k1", questionNumber: i + 1, subjectId: "korean", dueAt: dueDay(-1) }),
    ),
    ...Array.from({ length: 4 }, (_, i) =>
      cand({ paperId: "k2", questionNumber: i + 1, subjectId: "korean", dueAt: dueDay(-1) }),
    ),
  ];

  const queue = buildDueQueue(items, [], NOW, { total: 20, newItems: 0 });
  let samePaperNeighbors = 0;
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].paperId === queue[i - 1].paperId) samePaperNeighbors++;
  }
  assert.equal(samePaperNeighbors, 0);
});

test("신규 승격도 한 문제지에 몰리지 않는다", () => {
  const pending = [
    ...Array.from({ length: 30 }, (_, i) =>
      pend({ paperId: "hot", questionNumber: i + 1, subjectId: "korean", wrongCount: 2 }),
    ),
    ...Array.from({ length: 30 }, (_, i) =>
      pend({
        paperId: `other${i % 5}`,
        questionNumber: i + 1,
        subjectId: "korean",
        wrongCount: 2,
      }),
    ),
  ];

  const queue = buildDueQueue([], pending, NOW, { total: 20, newItems: 10 });
  assert.equal(queue.length, 10);
  assert.ok(
    queue.filter((q) => q.paperId === "hot").length <= paperCapForLimit(10),
    "신규 몫도 문제지 상한을 지켜야 한다",
  );
});
