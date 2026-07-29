// 섞어풀기 후보 뽑기 — 웹·모바일 공유(순수 계산).
//
// 원래는 미극복 오답 전체를 통째로 섞어 앞에서 잘랐다(shuffle().slice()). 오답이
// 30개일 때는 그래도 됐지만, 반년 회독하면 수백~수천 개가 쌓인다. 그 상태에서
// 균등 무작위로 20개를 뽑으면 "두 번 틀린 문제"와 "반년 전에 한 번 틀린 문제"가
// 같은 확률로 나온다 — 사용자가 제일 위험한 문항을 만날 확률이 계속 희석된다.
//
// 그렇다고 "2번 이상 틀린 것만" / "최근 30일만" 같은 필터로 자르면 반대쪽이
// 깨진다. 조건 밖 문항은 영구히 안 나온다. 시험 준비에서 제일 위험한 건
// "오래돼서 잊은 오답"인데 그게 통째로 사라진다.
//
// 그래서 필터가 아니라 층(tier)별 정원제로 간다. 위험한 층에 정원을 많이 주되
// 꼬리(오래된 미극복)에도 자리를 남긴다. 층 안에서는 여전히 무작위 —
// 같은 문항만 계속 나오면 그것도 회독이 아니다.
//
//   A층(가중 3): 2번 이상 틀림          — 반복해서 무너지는 문항
//   B층(가중 2): 30일 이내에 틀림        — 최근 약점
//   C층(가중 1): 나머지 미극복           — 잊힌 꼬리
//
// 20문항이면 대략 A 10 · B 7 · C 3. 어느 층이 모자라면 그 자리는 다른 층이 메운다
// (정원이 남아서 20개를 못 채우는 일은 없다).
//
// 복습(간격 반복, review-queue.ts)과는 다른 기능이다. 복습은 문항마다 계산된
// srs_due_at 이 된 것만 연체 순으로 낸다(무작위 없음). 여기는 "지금 아무거나 좀
// 풀고 싶다"는 요구를 받는 자리라, 무작위성을 없애지 않고 기울이기만 한다.

// B층 경계. 이보다 최근에 틀렸으면 "최근 약점"으로 본다.
export const REVIEW_PICK_RECENT_DAYS = 30;

// A·B·C 층 정원 비율.
export const REVIEW_PICK_TIER_WEIGHTS = [3, 2, 1] as const;

// A층 진입 기준(틀린 횟수).
export const REVIEW_PICK_REPEAT_THRESHOLD = 2;

export type ReviewPickCandidate = {
  wrongCount: number;
  // ISO 문자열. 마지막으로 이 문항을 틀린 시각.
  lastWrongAt: string;
};

export type ReviewPickStrategy = "weighted" | "random";

// 0 = A층, 1 = B층, 2 = C층.
export function reviewPickTier(c: ReviewPickCandidate, now: Date = new Date()): 0 | 1 | 2 {
  if (c.wrongCount >= REVIEW_PICK_REPEAT_THRESHOLD) return 0;
  const cutoff = now.getTime() - REVIEW_PICK_RECENT_DAYS * 24 * 60 * 60 * 1000;
  const at = Date.parse(c.lastWrongAt);
  // 날짜를 못 읽으면 최근이라고 우기지 않는다(C층으로).
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

// 층별 정원 계산(최대잉여법). floor 로만 나누면 합이 limit 에 못 미치므로, 남는
// 자리는 소수부가 큰 층부터 준다 — limit 20 이면 10 / 7 / 3.
function tierQuotas(limit: number): number[] {
  const weights = [...REVIEW_PICK_TIER_WEIGHTS];
  const total = weights.reduce((s, w) => s + w, 0);
  const exact = weights.map((w) => (limit * w) / total);
  const quotas = exact.map((v) => Math.floor(v));
  let left = limit - quotas.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    // 소수부가 같으면 위험한 층(작은 인덱스)이 먼저 가져간다.
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    quotas[i]++;
    left--;
  }
  return quotas;
}

// 층별 정원제로 limit 개를 뽑는다. 반환 순서도 섞어서 준다 — 정원 순으로 이어
// 붙이면 A층이 앞에 몰려 "앞부분만 어렵다"가 된다.
//
// rand 는 테스트에서 고정하기 위한 주입점(기본 Math.random).
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

  // 정원이 남은 층(후보가 모자랐던 층)의 몫은 다른 층이 위험한 순서로 메운다.
  for (let t = 0; picked.length < cap && t < buckets.length; t++) {
    for (let i = taken[t]; picked.length < cap && i < buckets[t].length; i++) {
      picked.push(buckets[t][i]);
    }
  }

  return shuffleInPlace(picked, rand);
}

// "전체 랜덤" 칩을 골랐을 때의 경로. 기존 동작 그대로 — 층 구분 없이 균등 추출.
export function pickRandomReviewCandidates<T>(
  candidates: T[],
  limit: number,
  rand: () => number = Math.random,
): T[] {
  const cap = Math.max(0, Math.floor(limit));
  if (cap === 0) return [];
  return shuffleInPlace([...candidates], rand).slice(0, cap);
}

// 전략에 맞는 추출. 호출부가 분기를 들고 있지 않도록 여기서 갈라준다.
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
