import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCoachTargets } from "@/lib/diagnosis-generate";
import type { ConceptStat, DiagnosisAggregate } from "@/lib/diagnosis-live";

// 극복법 대상 선정 규칙. 개념 하나당 실API 생성이 붙어 요금이 개념 수에 정비례하므로,
// "과목당 7개 · 전체 20개"는 요금 상한 그 자체다. 규칙이 조용히 어긋나면 요금이 새거나
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

test("과목당 7개를 넘지 않는다", () => {
  const picked = pickCoachTargets(aggOf(["korean", "english"], 12), new Set());
  for (const slug of ["korean", "english"]) {
    const n = picked.filter((c) => c.subjectSlug === slug).length;
    assert.ok(n <= 7, `${slug}: ${n}개`);
  }
});

test("전체 20개를 넘지 않는다", () => {
  // 5과목 × 7개 = 35개가 되려는 상황.
  const picked = pickCoachTargets(aggOf(["a", "b", "c", "d", "e"], 12), new Set());
  assert.equal(picked.length, 20);
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
  const two = pickCoachTargets(aggOf(["a", "b"], 12), new Set());
  assert.equal(two.length, 14); // 2과목 × 7
  assert.equal(two.filter((c) => c.subjectSlug === "a").length, 7);
});

test("뺀 과목은 대상에서 제외된다", () => {
  const picked = pickCoachTargets(aggOf(["a", "b", "c"], 12), new Set(["b"]));
  assert.ok(!picked.some((c) => c.subjectSlug === "b"));
  assert.equal(picked.length, 14); // 남은 2과목 × 7
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
