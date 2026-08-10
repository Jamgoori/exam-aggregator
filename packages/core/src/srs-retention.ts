// 실측 유지율 집계 — 배정한 간격에서 실제로 몇 %가 맞았는지.
//
// 간격 반복은 상수를 실측으로 조정해야 쓸 만해지는 알고리즘이다. ease 2.5, 학습
// 단계 1·3일, 연체 점수 상한 14일, leech 8회 — 전부 근거가 있는 값이지만 이
// 서비스의 문항·사용자로 검증된 값은 아니다. srs_reviews 로그가 그걸 확인하려고
// 쌓여 왔는데, 지금까지 읽는 코드가 없었다.
//
// 여기는 집계 규칙만 둔다(순수 계산). 데이터를 어디서 읽을지는 각 앱이 정한다:
//  - 운영 전체 집계: apps/web/scripts/srs-retention-report.mjs (service_role)
//  - 시뮬레이션 값:  simulate.ts — 같은 함수로 재서 실측과 나란히 비교한다
//
// 두 쪽이 같은 구간·같은 보정을 써야 비교가 성립하므로 여기 하나만 둔다.

// 목표 유지율. 예정일에 다시 만났을 때 이 정도는 기억하고 있어야 "간격이 맞다"고
// 본다. SM-2 계열이 통상 겨냥하는 값이고, 이보다 낮으면 간격이 길어 헛도는 복습이
// 되고, 지나치게 높으면 너무 자주 보여줘서 하루 몫을 낭비하는 것이다.
export const TARGET_RETENTION = 0.9;

// 목표 주변 허용 폭. 표본 잡음으로 매번 "조정 필요"가 뜨면 아무도 안 본다.
export const RETENTION_TOLERANCE = 0.05;

// 이 미만이면 판정하지 않는다. 간격 구간별로 나누면 표본이 금방 얇아진다.
export const RETENTION_MIN_SAMPLES = 30;

// 객관식 찍기 확률(4지선다 기준). "정답률"과 "기억하고 있을 확률"은 다른 값이라,
// 간격을 정할 때 쓰는 건 후자여야 한다. 모르고도 25%가 맞기 때문이다.
export const DEFAULT_GUESS_RATE = 0.25;

// 간격 구간. 학습 단계(1·3일)와 그 뒤 곱셈 구간을 가른다.
export const RETENTION_BUCKETS = [
  { label: "1-2일", min: 1, max: 2 },
  { label: "3-7일", min: 3, max: 7 },
  { label: "8-20일", min: 8, max: 20 },
  { label: "21-60일", min: 21, max: 60 },
  { label: "60일+", min: 61, max: Number.POSITIVE_INFINITY },
] as const;

export type RetentionBucketLabel = (typeof RETENTION_BUCKETS)[number]["label"];

export function retentionBucketOf(intervalDays: number): RetentionBucketLabel {
  for (const b of RETENTION_BUCKETS) {
    if (intervalDays >= b.min && intervalDays <= b.max) return b.label;
  }
  return RETENTION_BUCKETS[RETENTION_BUCKETS.length - 1].label;
}

// srs_reviews 한 행에서 집계에 필요한 것만.
export type ReviewLogRow = {
  // 채점 직전에 배정돼 있던 간격 = 이 채점이 검증한 대상.
  prevIntervalDays: number;
  // 직전 채점 이후 실제 경과일. null이면 판단 불가(예전 행).
  elapsedDays: number | null;
  isCorrect: boolean;
};

export type RetentionVerdict =
  // 관측이 목표를 밑돈다 = 그 구간 간격이 길다(잊은 뒤에 만난다).
  | "간격이 길다"
  // 관측이 목표를 웃돈다 = 너무 일찍 보여주고 있다(하루 몫이 아깝다).
  | "간격이 짧다"
  | "적정"
  | "표본 부족";

export type RetentionBucket = {
  bucket: RetentionBucketLabel;
  // 예정일 이후에 본 채점 수(= 유지율을 말할 수 있는 표본).
  reviews: number;
  // 그중 정답 비율. 찍어서 맞힌 것도 포함된다.
  accuracy: number;
  // 찍기를 걷어낸 "실제로 기억하고 있었을 확률" 추정치.
  recall: number;
  // 이 구간 문항들의 평균 배정 간격(일).
  meanInterval: number;
  // 목표 유지율에 맞추려면 간격에 곱해야 하는 값. 1보다 크면 늘려도 되고, 작으면
  // 줄여야 한다. 표본이 모자라거나 계산이 불가능하면 null.
  suggestedFactor: number | null;
  verdict: RetentionVerdict;
};

export type RetentionSummary = {
  buckets: RetentionBucket[];
  // 예정일 전에 끌려 나온 채점 수(회독·섞어풀기). 유지율 표본에서는 뺐지만, 이
  // 숫자 자체가 "이 서비스의 채점이 얼마나 스케줄 밖에서 일어나는가"를 말해준다.
  earlyReviews: number;
  // 스케줄이 없던 채점(prev_interval_days = 0). 승격 직후 첫 채점이다.
  unscheduledReviews: number;
  totalRows: number;
};

export type RetentionOptions = {
  guessRate?: number;
  target?: number;
  tolerance?: number;
  minSamples?: number;
};

// 목표 유지율에 맞추려면 간격을 몇 배로 해야 하는지.
//
// 지수 망각 곡선을 가정한다: 회상 확률 p = exp(-간격/안정도). 관측 p 로 안정도를
// 되풀면 목표 t 에 해당하는 간격이 나오고, 두 간격의 비가 곧 배수다.
//
//   p = exp(-I/S)  ⇒  S = -I / ln p
//   I* = -S · ln t = I · (ln t / ln p)
//
// 모델 가정이 섞인 값이라 "3일을 정확히 4.7일로 바꿔라"로 읽으면 안 된다. 방향과
// 크기(두 배인가 반인가)를 보는 값이다.
export function suggestedIntervalFactor(
  recall: number,
  target: number = TARGET_RETENTION,
): number | null {
  if (!(recall > 0) || recall >= 1) return null;
  const factor = Math.log(target) / Math.log(recall);
  if (!Number.isFinite(factor) || factor <= 0) return null;
  // 표본 잡음으로 10배 같은 값이 나오면 읽는 사람을 오도한다.
  return Math.min(5, Math.max(0.2, factor));
}

// 찍기를 걷어낸 회상 확률 추정치. 4지선다에서 정답률 40%는 "40% 기억"이 아니라
// 20% 기억 + 나머지를 찍어서 맞은 것이다.
export function guessCorrectedRecall(
  accuracy: number,
  guessRate: number = DEFAULT_GUESS_RATE,
): number {
  if (guessRate <= 0 || guessRate >= 1) return accuracy;
  return Math.max(0, Math.min(1, (accuracy - guessRate) / (1 - guessRate)));
}

// 로그 행들을 간격 구간별 유지율로 접는다.
//
// 예정일 이후에 본 채점만 표본으로 쓴다. 이 서비스는 회독·섞어풀기가 스케줄과
// 무관하게 같은 문항을 다시 채점하는데, 62일짜리를 5일 만에 만나 틀린 것을 유지율에
// 넣으면 "간격이 길다"는 잘못된 결론이 나온다. 그건 스케줄의 실패가 아니다.
export function summarizeRetention(
  rows: ReviewLogRow[],
  opts: RetentionOptions = {},
): RetentionSummary {
  const guessRate = opts.guessRate ?? DEFAULT_GUESS_RATE;
  const target = opts.target ?? TARGET_RETENTION;
  const tolerance = opts.tolerance ?? RETENTION_TOLERANCE;
  const minSamples = opts.minSamples ?? RETENTION_MIN_SAMPLES;

  const acc = new Map<
    RetentionBucketLabel,
    { reviews: number; correct: number; intervalSum: number }
  >();
  let earlyReviews = 0;
  let unscheduledReviews = 0;

  for (const row of rows) {
    if (row.prevIntervalDays <= 0) {
      unscheduledReviews++;
      continue;
    }
    // elapsed 를 모르는 행(예전 데이터)은 예정일에 본 것으로 친다 — 로그가 생기기
    // 전 동작과 같은 가정이다.
    const elapsed = row.elapsedDays ?? row.prevIntervalDays;
    if (elapsed < row.prevIntervalDays) {
      earlyReviews++;
      continue;
    }

    const bucket = retentionBucketOf(row.prevIntervalDays);
    const cur = acc.get(bucket) ?? { reviews: 0, correct: 0, intervalSum: 0 };
    cur.reviews++;
    cur.intervalSum += row.prevIntervalDays;
    if (row.isCorrect) cur.correct++;
    acc.set(bucket, cur);
  }

  const buckets: RetentionBucket[] = RETENTION_BUCKETS.map(({ label }) => {
    const cur = acc.get(label) ?? { reviews: 0, correct: 0, intervalSum: 0 };
    const accuracy = cur.reviews === 0 ? 0 : cur.correct / cur.reviews;
    const recall = guessCorrectedRecall(accuracy, guessRate);
    const enough = cur.reviews >= minSamples;

    return {
      bucket: label,
      reviews: cur.reviews,
      accuracy,
      recall,
      meanInterval: cur.reviews === 0 ? 0 : cur.intervalSum / cur.reviews,
      suggestedFactor: enough ? suggestedIntervalFactor(recall, target) : null,
      verdict: !enough
        ? "표본 부족"
        : recall < target - tolerance
          ? "간격이 길다"
          : recall > target + tolerance
            ? "간격이 짧다"
            : "적정",
    };
  });

  return {
    buckets,
    earlyReviews,
    unscheduledReviews,
    totalRows: rows.length,
  };
}

// 사람이 읽는 표. 스크립트와 시뮬레이터가 같은 모양으로 찍어야 나란히 비교된다.
export function formatRetentionTable(summary: RetentionSummary): string {
  const lines = [
    "  간격 구간   표본    정답률   회상추정   권장 배수   판정",
    "  ─────────────────────────────────────────────────────────────",
  ];
  for (const b of summary.buckets) {
    const factor = b.suggestedFactor == null ? "  －  " : `×${b.suggestedFactor.toFixed(2)}`;
    lines.push(
      [
        `  ${b.bucket.padEnd(9)}`,
        String(b.reviews).padStart(5),
        `${(b.accuracy * 100).toFixed(0).padStart(6)}%`,
        `${(b.recall * 100).toFixed(0).padStart(8)}%`,
        factor.padStart(10),
        `   ${b.verdict}`,
      ].join(""),
    );
  }
  lines.push(
    `  예정일 전 채점(회독·섞어풀기) ${summary.earlyReviews} · 스케줄 없던 채점 ${summary.unscheduledReviews} · 전체 ${summary.totalRows}`,
  );
  return lines.join("\n");
}
