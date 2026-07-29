import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDueQueue,
  countBySubject,
  forecastDueByDay,
  DUE_QUEUE_LIMIT,
  type DueCandidate,
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
  const queue = buildDueQueue(many, NOW);
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
  const queue = buildDueQueue(items, NOW);
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
  const queue = buildDueQueue(items, NOW);
  assert.equal(queue.length, 9);
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
