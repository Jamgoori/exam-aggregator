import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDueQueue,
  countBySubject,
  forecastDueByDay,
  DUE_QUEUE_LIMIT,
  NEW_QUEUE_LIMIT,
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

test("오래 연체된 것 먼저, 같으면 반복해서 무너진 것 먼저", () => {
  const queue = buildDueQueue(
    [
      cand({ questionNumber: 1, dueAt: dueDay(0), lapses: 0 }),
      cand({ questionNumber: 2, dueAt: dueDay(-5), lapses: 0 }),
      cand({ questionNumber: 3, dueAt: dueDay(0), lapses: 4 }),
    ],
    [],
    NOW,
  );
  assert.deepEqual(
    queue.map((q) => q.questionNumber),
    [2, 3, 1],
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

test("같은 입력이면 같은 큐가 나온다(배너 숫자 = 세션 문항)", () => {
  // 배너와 세션 생성이 이 함수를 각각 호출한다. 여기서 흔들리면 "20개"라고 띄워
  // 놓고 다른 문항이 나온다.
  const due = [cand({ questionNumber: 1, dueAt: dueDay(-1) })];
  const pending = Array.from({ length: 30 }, (_, i) =>
    pend({ paperId: "new", questionNumber: i + 1, wrongCount: (i % 3) + 1 }),
  );

  assert.deepEqual(buildDueQueue(due, pending, NOW), buildDueQueue(due, pending, NOW));
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
