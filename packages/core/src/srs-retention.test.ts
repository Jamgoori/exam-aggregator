import { test } from "node:test";
import assert from "node:assert/strict";
import {
  guessCorrectedRecall,
  retentionBucketOf,
  suggestedIntervalFactor,
  summarizeRetention,
  RETENTION_MIN_SAMPLES,
  TARGET_RETENTION,
  type ReviewLogRow,
} from "./srs-retention";

// 이 집계가 알고리즘 상수를 바꾸는 근거가 된다. 여기가 틀리면 멀쩡한 값을 고치거나
// 틀린 값을 그냥 둔다.

function rows(n: number, o: Partial<ReviewLogRow> & { correctRate: number }): ReviewLogRow[] {
  const out: ReviewLogRow[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      prevIntervalDays: o.prevIntervalDays ?? 5,
      elapsedDays: o.elapsedDays ?? o.prevIntervalDays ?? 5,
      isCorrect: i < Math.round(n * o.correctRate),
    });
  }
  return out;
}

test("예정일 전에 끌려 나온 채점은 유지율 표본에서 뺀다", () => {
  // 62일짜리를 5일 만에 만나 틀린 것은 스케줄의 실패가 아니다. 이걸 섞으면
  // 회독을 많이 하는 사용자일수록 "간격이 길다"는 잘못된 결론이 나온다.
  const summary = summarizeRetention([
    ...rows(40, { prevIntervalDays: 10, elapsedDays: 10, correctRate: 1 }),
    ...rows(60, { prevIntervalDays: 10, elapsedDays: 2, correctRate: 0 }),
  ]);

  const bucket = summary.buckets.find((b) => b.bucket === "8-20일")!;
  assert.equal(bucket.reviews, 40);
  assert.equal(bucket.accuracy, 1);
  assert.equal(summary.earlyReviews, 60);
});

test("스케줄이 없던 채점(승격 직후)은 따로 센다", () => {
  const summary = summarizeRetention(rows(10, { prevIntervalDays: 0, correctRate: 0.5 }));
  assert.equal(summary.unscheduledReviews, 10);
  assert.ok(summary.buckets.every((b) => b.reviews === 0));
});

test("표본이 모자라면 판정하지 않는다", () => {
  const summary = summarizeRetention(
    rows(RETENTION_MIN_SAMPLES - 1, { prevIntervalDays: 5, correctRate: 0.2 }),
  );
  const bucket = summary.buckets.find((b) => b.bucket === "3-7일")!;
  assert.equal(bucket.verdict, "표본 부족");
  assert.equal(bucket.suggestedFactor, null);
});

test("정답률이 목표를 밑돌면 간격이 길다고 판정한다", () => {
  const summary = summarizeRetention(rows(100, { prevIntervalDays: 5, correctRate: 0.5 }));
  const bucket = summary.buckets.find((b) => b.bucket === "3-7일")!;
  assert.equal(bucket.verdict, "간격이 길다");
  // 줄이라는 방향이 나와야 한다.
  assert.ok(bucket.suggestedFactor! < 1);
});

test("찍기를 걷어낸 회상 확률로 판정한다", () => {
  // 4지선다 정답률 92%는 목표(90%)를 넘긴 것처럼 보이지만, 찍기를 걷어내면 89%다.
  assert.equal(guessCorrectedRecall(0.25), 0);
  assert.ok(Math.abs(guessCorrectedRecall(0.92) - 0.8933) < 0.001);
  assert.equal(guessCorrectedRecall(1), 1);
});

test("권장 배수는 지수 망각 곡선을 되풀어 낸다", () => {
  // 목표에 정확히 맞으면 그대로 두라고 해야 한다.
  const same = suggestedIntervalFactor(TARGET_RETENTION);
  assert.ok(Math.abs(same! - 1) < 1e-9);

  // 목표보다 잘 기억하면 늘려도 된다.
  assert.ok(suggestedIntervalFactor(0.97)! > 1);
  // 못 기억하면 줄여야 한다.
  assert.ok(suggestedIntervalFactor(0.5)! < 1);
  // 계산이 불가능한 값은 null.
  assert.equal(suggestedIntervalFactor(0), null);
  assert.equal(suggestedIntervalFactor(1), null);
});

test("구간 경계", () => {
  assert.equal(retentionBucketOf(1), "1-2일");
  assert.equal(retentionBucketOf(2), "1-2일");
  assert.equal(retentionBucketOf(3), "3-7일");
  assert.equal(retentionBucketOf(20), "8-20일");
  assert.equal(retentionBucketOf(21), "21-60일");
  assert.equal(retentionBucketOf(180), "60일+");
});

test("elapsed_days가 없는 예전 행은 예정일에 본 것으로 친다", () => {
  const summary = summarizeRetention(
    rows(40, { prevIntervalDays: 5, elapsedDays: null as unknown as number, correctRate: 1 }),
  );
  assert.equal(summary.buckets.find((b) => b.bucket === "3-7일")!.reviews, 40);
  assert.equal(summary.earlyReviews, 0);
});
