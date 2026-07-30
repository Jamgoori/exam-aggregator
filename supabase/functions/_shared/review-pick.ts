// packages/core/src/review-pick.ts 포팅. 정본은 core 쪽이고 테스트도 거기 있다
// (packages/core/src/review-pick.test.ts). 엣지 함수는 워크스페이스 패키지를 번들에
// 못 넣어 같은 규칙을 여기에 한 벌 더 둔다 — 한쪽만 고치면 웹 섞어풀기와 앱
// 섞어풀기가 조용히 다른 문제를 내게 되므로, 층 기준·가중치를 바꿀 때는 반드시
// 양쪽을 함께 고칠 것.

export const REVIEW_PICK_RECENT_DAYS = 30;
export const REVIEW_PICK_TIER_WEIGHTS = [3, 2, 1] as const;
export const REVIEW_PICK_REPEAT_THRESHOLD = 2;

export type ReviewPickCandidate = {
  wrongCount: number;
  lastWrongAt: string;
};

export type ReviewPickStrategy = "weighted" | "random";

export function reviewPickTier(
  c: ReviewPickCandidate,
  now: Date = new Date(),
): 0 | 1 | 2 {
  if (c.wrongCount >= REVIEW_PICK_REPEAT_THRESHOLD) return 0;
  const cutoff = now.getTime() - REVIEW_PICK_RECENT_DAYS * 24 * 60 * 60 * 1000;
  const at = Date.parse(c.lastWrongAt);
  if (Number.isFinite(at) && at >= cutoff) return 1;
  return 2;
}

function shuffleInPlace<T>(a: T[], rand: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function tierQuotas(limit: number): number[] {
  const weights = [...REVIEW_PICK_TIER_WEIGHTS];
  const total = weights.reduce((s, w) => s + w, 0);
  const exact = weights.map((w) => (limit * w) / total);
  const quotas = exact.map((v) => Math.floor(v));
  let left = limit - quotas.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    quotas[i]++;
    left--;
  }
  return quotas;
}

export function pickWeightedReviewCandidates<T extends ReviewPickCandidate>(
  candidates: T[],
  limit: number,
  opts: { now?: Date; rand?: () => number } = {},
): T[] {
  const rand = opts.rand ?? Math.random;
  const now = opts.now ?? new Date();
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0 || candidates.length === 0) return [];
  if (candidates.length <= cap) return shuffleInPlace([...candidates], rand);

  const buckets: T[][] = [[], [], []];
  for (const c of candidates) buckets[reviewPickTier(c, now)].push(c);
  for (const b of buckets) shuffleInPlace(b, rand);

  const quotas = tierQuotas(cap);
  const picked: T[] = [];
  const taken = [0, 0, 0];
  for (let t = 0; t < buckets.length; t++) {
    const take = Math.min(quotas[t], buckets[t].length);
    for (let i = 0; i < take; i++) picked.push(buckets[t][i]);
    taken[t] = take;
  }
  for (let t = 0; picked.length < cap && t < buckets.length; t++) {
    for (let i = taken[t]; picked.length < cap && i < buckets[t].length; i++) {
      picked.push(buckets[t][i]);
    }
  }
  return shuffleInPlace(picked, rand);
}

export function pickRandomReviewCandidates<T>(
  candidates: T[],
  limit: number,
  rand: () => number = Math.random,
): T[] {
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0) return [];
  return shuffleInPlace([...candidates], rand).slice(0, cap);
}

export function pickReviewCandidates<T extends ReviewPickCandidate>(
  candidates: T[],
  limit: number,
  strategy: ReviewPickStrategy,
  opts: { now?: Date; rand?: () => number } = {},
): T[] {
  return strategy === "random"
    ? pickRandomReviewCandidates(candidates, limit, opts.rand)
    : pickWeightedReviewCandidates(candidates, limit, opts);
}
