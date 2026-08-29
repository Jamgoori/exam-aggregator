import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCoachTargets } from "@/lib/diagnosis-generate";
import { COACH_MAX_TOTAL, COACH_PER_SUBJECT } from "@/lib/diagnosis-limits";
import type { ConceptStat, DiagnosisAggregate } from "@/lib/diagnosis-live";

// 극복법 대상 선정 규칙. 개념 하나당 실API 생성이 붙어 요금이 개념 수에 정비례하므로,
// 과목당·전체 상한(diagnosis-limits.ts)은 요금 상한 그 자체다. 규칙이 조용히 어긋나면 요금이 새거나
// (상한 초과) 특정 과목이 통째로 빠진다.

function concept(subjectSlug: string, n: number, wrongCount: number): ConceptStat {
  return {
    concept: `${subjectSlug}-${n}`,
    conceptId: `${subjectSlug}-${n}`,
    conceptKind: null,
    subject: subjectSlug,
    subjectSlug,
    wrongCount,
    answeredCount: 20,
    accuracyPct: 50,
    corpusCount: 10,
    scoreGainPct: 1,
  };
}

// 과목마다 perSubject 개씩, 오답 수를 내림차순으로 만든 집계.
function aggOf(subjects: string[], perSubject: number): DiagnosisAggregate {
  const concepts: ConceptStat[] = [];
  for (const [si, slug] of subjects.entries())
    for (let i = 0; i < perSubject; i++)
      concepts.push(concept(slug, i, 100 - si * 10 - i));
  concepts.sort((a, b) => b.wrongCount - a.wrongCount);
  return {
    window: { days: 7, widened: false },
    totals: { attempts: 0, wrongQuestions: 0, conceptsWithKeyword: concepts.length },
    subjects: [],
    concepts,
    bySubject: [],
  };
}

test("과목당 상한을 넘지 않는다", () => {
  const picked = pickCoachTargets(aggOf(["korean", "english"], 12), new Set());
  for (const slug of ["korean", "english"]) {
    const n = picked.filter((c) => c.subjectSlug === slug).length;
    assert.ok(n <= COACH_PER_SUBJECT, `${slug}: ${n}개`);
  }
});

test("전체 상한을 넘지 않는다", () => {
  // 5과목 × 과목당 상한이면 상한을 훌쩍 넘기려는 상황.
  const picked = pickCoachTargets(aggOf(["a", "b", "c", "d", "e"], 12), new Set());
  assert.equal(picked.length, COACH_MAX_TOTAL);
});

test("상한에 걸려도 모든 과목이 다뤄진다", () => {
  // 과목 순서대로 7개씩 채우면 뒤쪽 두 과목이 통째로 빠진다 — 순위별로 돌아가며 채워야 한다.
  const picked = pickCoachTargets(aggOf(["a", "b", "c", "d", "e"], 12), new Set());
  for (const slug of ["a", "b", "c", "d", "e"]) {
    assert.ok(
      picked.some((c) => c.subjectSlug === slug),
      `${slug} 과목이 통째로 빠졌다`,
    );
  }
});

test("과목 수가 적으면 남은 과목이 상한을 더 깊게 쓴다", () => {
  // 과목이 적으면 한 과목이 가져가는 자리가 늘어난다. 두 상한 중 낮은 쪽까지만 채우므로
  // (과목당 7 · 전체 10) 여기서는 전체 상한이 먼저 걸린다 — 상한 값을 조정해도 이 성질은
  // 유지돼야 해서 숫자를 박지 않고 두 상수로 쓴다.
  const two = pickCoachTargets(aggOf(["a", "b"], 12), new Set());
  assert.equal(two.length, Math.min(2 * COACH_PER_SUBJECT, COACH_MAX_TOTAL));
  // 5과목일 때(과목당 2개)보다 한 과목이 더 깊게 다뤄진다.
  const five = pickCoachTargets(aggOf(["a", "b", "c", "d", "e"], 12), new Set());
  assert.ok(
    two.filter((c) => c.subjectSlug === "a").length >
      five.filter((c) => c.subjectSlug === "a").length,
  );
});

test("뺀 과목은 대상에서 제외된다", () => {
  const picked = pickCoachTargets(aggOf(["a", "b", "c"], 12), new Set(["b"]));
  assert.ok(!picked.some((c) => c.subjectSlug === "b"));
  // 남은 2과목이 상한까지 채운다(과목당 7 · 전체 10 중 낮은 쪽).
  assert.equal(picked.length, Math.min(2 * COACH_PER_SUBJECT, COACH_MAX_TOTAL));
});

test("과목 안에서는 많이 틀린 순, 동률이면 정답률이 낮은 쪽 먼저", () => {
  const agg = aggOf(["a"], 0);
  agg.concepts = [
    { ...concept("a", 1, 5), accuracyPct: 80 },
    { ...concept("a", 2, 5), accuracyPct: 30 },
    { ...concept("a", 3, 9), accuracyPct: 90 },
  ];
  const picked = pickCoachTargets(agg, new Set());
  assert.deepEqual(picked.map((c) => c.concept), ["a-3", "a-2", "a-1"]);
});

test("전 과목을 빼면 빈 배열 — 빈 입력으로 API를 부르지 않는다", () => {
  const picked = pickCoachTargets(aggOf(["a", "b"], 5), new Set(["a", "b"]));
  assert.equal(picked.length, 0);
});

// 개념을 직접 고른 경우(화면 체크박스). 자동 선정 규칙(과목당 상한·순위별 채우기)은
// 통째로 비켜서고, 고른 것만 그대로 나가야 한다 — 우리가 "더 시급한 것"으로 바꿔치면
// 체크박스가 장식이 된다. 단 전체 상한(=요금 상한)만은 그대로 걸린다.
test("개념을 직접 고르면 고른 것만 대상이 된다", () => {
  const agg = aggOf(["a", "b"], 5);
  const picked = pickCoachTargets(agg, new Set(), [
    { conceptId: "a-3", concept: "a-3" },
    { conceptId: "b-1", concept: "b-1" },
  ]);
  assert.deepEqual(
    picked.map((c) => c.concept).sort(),
    ["a-3", "b-1"],
  );
});

test("직접 고른 개념도 전체 상한을 넘지 않는다", () => {
  const agg = aggOf(["a", "b", "c"], 12);
  const picked = pickCoachTargets(
    agg,
    new Set(),
    agg.concepts.map((c) => ({ conceptId: c.conceptId, concept: c.concept })),
  );
  assert.equal(picked.length, COACH_MAX_TOTAL);
});

test("직접 고르면 과목 제외 설정은 무시된다(선택이 과목까지 정한다)", () => {
  const picked = pickCoachTargets(aggOf(["a", "b"], 5), new Set(["b"]), [
    { conceptId: "b-0", concept: "b-0" },
  ]);
  assert.deepEqual(picked.map((c) => c.concept), ["b-0"]);
});

test("고른 개념이 이 기간 집계에 없으면 조용히 빠진다", () => {
  // 표본 문항이 없는 개념을 프롬프트에 실으면 모델이 일반론밖에 못 낸다(요금만 나간다).
  const picked = pickCoachTargets(aggOf(["a"], 3), new Set(), [
    { conceptId: "a-0", concept: "a-0" },
    { conceptId: "없는개념", concept: "없는개념" },
  ]);
  assert.deepEqual(picked.map((c) => c.concept), ["a-0"]);
});

test("정본 id가 없는 개념은 표기로 맞춘다", () => {
  const agg = aggOf(["a"], 0);
  agg.concepts = [{ ...concept("a", 1, 5), conceptId: null }];
  const picked = pickCoachTargets(agg, new Set(), [{ conceptId: null, concept: "a-1" }]);
  assert.equal(picked.length, 1);
});
