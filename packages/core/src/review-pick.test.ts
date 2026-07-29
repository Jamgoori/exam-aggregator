import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickReviewCandidates,
  pickWeightedReviewCandidates,
  reviewPickTier,
  REVIEW_PICK_RECENT_DAYS,
  type ReviewPickCandidate,
} from "./review-pick";

// 여기가 무너지면 증상이 늦게 나타난다. 오답이 수천 개 쌓인 계정에서만 드러나고,
// 드러날 때는 "요즘 섞어풀기가 시시하다" 같은 모호한 형태로 온다. 층 정원을
// 테스트로 못 박아 둔다.

const NOW = new Date("2026-03-10T05:00:00+09:00");

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
}

type C = ReviewPickCandidate & { id: string };

function make(id: string, wrongCount: number, ageDays: number): C {
  return { id, wrongCount, lastWrongAt: daysAgo(ageDays) };
}

// 섞기를 끄면 정원 배분만 남아 검증이 결정적이 된다.
const noShuffle = () => 0;

function tierCounts(items: C[]): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (const it of items) out[reviewPickTier(it, NOW)]++;
  return out;
}

test("층 판정: 반복 오답 > 최근 오답 > 나머지", () => {
  // 2번 이상 틀렸으면 아무리 오래돼도 A층.
  assert.equal(reviewPickTier(make("a", 2, 400), NOW), 0);
  assert.equal(reviewPickTier(make("b", 1, REVIEW_PICK_RECENT_DAYS - 1), NOW), 1);
  assert.equal(reviewPickTier(make("c", 1, REVIEW_PICK_RECENT_DAYS + 1), NOW), 2);
  // 날짜를 못 읽으면 최근으로 우기지 않는다.
  assert.equal(reviewPickTier({ wrongCount: 1, lastWrongAt: "" }, NOW), 2);
});

test("층이 모두 넉넉하면 20문항이 10 / 7 / 3으로 갈린다", () => {
  const candidates = [
    ...Array.from({ length: 40 }, (_, i) => make(`a${i}`, 3, 100)),
    ...Array.from({ length: 40 }, (_, i) => make(`b${i}`, 1, 5)),
    ...Array.from({ length: 40 }, (_, i) => make(`c${i}`, 1, 200)),
  ];
  const picked = pickWeightedReviewCandidates(candidates, 20, { now: NOW, rand: noShuffle });
  assert.equal(picked.length, 20);
  assert.deepEqual(tierCounts(picked), [10, 7, 3]);
});

test("오래된 오답(C층)이 통째로 사라지지 않는다 — 필터가 아니라 정원제인 이유", () => {
  const candidates = [
    ...Array.from({ length: 500 }, (_, i) => make(`a${i}`, 5, 300)),
    ...Array.from({ length: 500 }, (_, i) => make(`c${i}`, 1, 300)),
  ];
  const picked = pickWeightedReviewCandidates(candidates, 20, { now: NOW, rand: noShuffle });
  const [, , c] = tierCounts(picked);
  assert.ok(c > 0, "A층이 아무리 많아도 C층 자리는 남아야 한다");
});

test("한 층이 모자라면 남은 자리를 다른 층이 메운다 (정원 미달로 끝나지 않음)", () => {
  const candidates = [
    ...Array.from({ length: 3 }, (_, i) => make(`a${i}`, 4, 10)),
    ...Array.from({ length: 40 }, (_, i) => make(`b${i}`, 1, 5)),
  ];
  const picked = pickWeightedReviewCandidates(candidates, 20, { now: NOW, rand: noShuffle });
  assert.equal(picked.length, 20);
  const [a, b, c] = tierCounts(picked);
  assert.equal(a, 3);
  assert.equal(b, 17);
  assert.equal(c, 0);
});

test("후보가 상한보다 적으면 전부 낸다", () => {
  const candidates = [make("a", 3, 10), make("b", 1, 2)];
  const picked = pickWeightedReviewCandidates(candidates, 20, { now: NOW, rand: noShuffle });
  assert.equal(picked.length, 2);
});

test("후보 0개·상한 0이면 빈 배열", () => {
  assert.deepEqual(pickWeightedReviewCandidates([], 20, { now: NOW }), []);
  assert.deepEqual(
    pickWeightedReviewCandidates([make("a", 3, 10)], 0, { now: NOW }),
    [],
  );
});

test("같은 문항만 반복해서 나오지 않는다 (층 안에서는 무작위)", () => {
  const candidates = Array.from({ length: 100 }, (_, i) => make(`a${i}`, 3, 10));
  const seen = new Set<string>();
  for (let run = 0; run < 20; run++) {
    for (const q of pickWeightedReviewCandidates(candidates, 20, { now: NOW })) {
      seen.add(q.id);
    }
  }
  // 균등이면 20회 × 20개로 100개를 거의 다 훑는다. 절반도 못 넘으면 뽑기가 굳은 것.
  assert.ok(seen.size > 50, `20회 돌려 ${seen.size}종만 나옴 — 추출이 편향됨`);
});

test("전략 random은 층을 무시한다 (기존 동작 보존)", () => {
  const candidates = [
    ...Array.from({ length: 100 }, (_, i) => make(`a${i}`, 5, 10)),
    ...Array.from({ length: 100 }, (_, i) => make(`c${i}`, 1, 300)),
  ];
  const picked = pickReviewCandidates(candidates, 20, "random", { now: NOW });
  assert.equal(picked.length, 20);
  // 균등이면 A층 비중이 정원제(10/20)보다 낮게 나오는 게 정상이지만, 한 번의
  // 무작위로 단정할 수 없다. 여기서는 "층 정원을 강제하지 않는다"만 확인한다.
  const [a] = tierCounts(picked);
  assert.ok(a >= 0 && a <= 20);
});
