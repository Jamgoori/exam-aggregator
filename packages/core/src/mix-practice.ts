import { KST_TIME_ZONE } from "./format";

// 기출 섞어풀기 — 웹·모바일 공유(순수 함수).
//
// 오답 섞어풀기(review-pick.ts)가 "내가 틀린 문항"을 다시 내는 기능이라면, 기출
// 섞어풀기는 **한 과목의 기출 전체**(국가직·지방직·경찰·소방… 시행처를 가리지 않고)
// 에서 무작위로 뽑아 새 문제를 푸는 기능이다. 공시생은 같은 과목을 여러 직렬로
// 준비하는 일이 흔한데(국가직+지방직, 경찰+해경), 문제지 한 장씩 골라 푸는 것보다
// "국어 20문항 아무거나"가 하루 학습을 시작하기 훨씬 가볍다.
//
// 뽑는 규칙의 정본은 여기다. 웹 서버(apps/web/src/lib/mix-practice.ts)가 후보를
// 모아 이 함수에 넘기고, 세션 저장·채점은 오답 섞어풀기(review_sessions)와 같은
// 테이블·같은 풀이 화면을 그대로 쓴다(scope = "mix").

// 문항 수 선택지. 공무원 필기는 과목당 20문항이라 20이 기본이고, 10은 "잠깐 몸풀기",
// 40·60은 두세 과목 분량을 한 번에 훑는 용도다. 자유 입력은 MIN~MAX 사이로 받는다.
export const MIX_LIMIT_OPTIONS = [10, 20, 40, 60] as const;
export const MIX_DEFAULT_LIMIT = 20;
export const MIX_MIN_LIMIT = 5;
export const MIX_MAX_LIMIT = 100;

// 화면·서버가 같은 규칙으로 문항 수를 정리한다. 숫자가 아니거나 범위 밖이면 기본값.
export function clampMixLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return MIX_DEFAULT_LIMIT;
  return Math.min(MIX_MAX_LIMIT, Math.max(MIX_MIN_LIMIT, Math.round(n)));
}

export type MixCandidate = {
  paperId: string;
  questionNumber: number;
  // 문제지 급수("9급"·"7급"…, 없으면 null). 시작 화면의 급수 필터가 이 값으로 거른다.
  level?: string | null;
  // 정본 개념 id(question_explanations.concept_id, 합쳐진 개념은 합쳐진 쪽). 해설이 아직
  // 없는 문항은 null — 개념 분산에서 "어느 개념도 아닌" 문항으로 취급한다.
  conceptId?: string | null;
};

// 급수 필터. 빈 목록이면 전체. 급수가 없는 문제지(level null)는 "급수 없음" 키로 고른다.
export const MIX_NO_LEVEL = "__none__";

export function filterMixCandidatesByLevel<T extends MixCandidate>(
  candidates: T[],
  levels: readonly string[],
): T[] {
  if (levels.length === 0) return candidates;
  const set = new Set(levels);
  return candidates.filter((c) => set.has(c.level ?? MIX_NO_LEVEL));
}

export function mixCandidateKey(c: MixCandidate): string {
  return `${c.paperId}#${c.questionNumber}`;
}

function shuffleWith<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 문제지별로 묶어 라운드로빈 순서로 늘어놓는다. 균등 무작위로 뽑으면 문항이 많은
// 문제지(한 회차 40문항짜리 등)가 세션을 독점해 "섞어풀기"가 아니라 그 문제지 풀기가
// 된다. 문제지 순서와 문제지 안의 문항 순서를 각각 섞은 뒤 한 장에서 하나씩 돌아가며
// 집으면, 어느 문제지도 다른 문제지보다 두 문항 이상 앞서지 않는다.
function roundRobinByPaper<T extends MixCandidate>(
  items: T[],
  limit: number,
  rand: () => number,
): T[] {
  const byPaper = new Map<string, T[]>();
  for (const it of shuffleWith(items, rand)) {
    const list = byPaper.get(it.paperId) ?? [];
    list.push(it);
    byPaper.set(it.paperId, list);
  }
  const queues = shuffleWith([...byPaper.values()], rand);
  const out: T[] = [];
  let idx = 0;
  while (out.length < limit && queues.length > 0) {
    const q = queues[idx % queues.length];
    const next = q.shift();
    if (next) out.push(next);
    if (q.length === 0) {
      queues.splice(idx % queues.length, 1);
      // 빈 큐를 뺐으므로 같은 자리가 다음 큐가 된다 — idx를 늘리지 않는다.
      if (queues.length === 0) break;
      idx = idx % queues.length;
    } else {
      idx = (idx + 1) % queues.length;
    }
  }
  return out;
}

// 개념이 뭉치지 않게 고른다. 순서대로 훑되 같은 개념은 세션에 하나씩만 먼저 담고,
// 그래도 정원이 남으면 개념당 2개, 3개… 로 상한을 올려가며 채운다. 개념이 없는 문항
// (해설 미생성)은 상한을 받지 않는다 — 그 문항을 뒤로 밀면 해설 커버리지가 낮은 과목
// 에서 정원을 못 채운다.
//
// counts 를 밖에서 넘겨 두 번 부를 때(안 푼 문항 → 푼 문항) 개념 수가 이어지게 한다.
function takeSpreadByConcept<T extends MixCandidate>(
  ordered: T[],
  need: number,
  counts: Map<string, number>,
): T[] {
  const out: T[] = [];
  if (need <= 0 || ordered.length === 0) return out;
  const taken = new Set<string>();
  let cap = 1;
  while (out.length < need && taken.size < ordered.length) {
    let progressed = false;
    for (const c of ordered) {
      if (out.length >= need) break;
      const key = mixCandidateKey(c);
      if (taken.has(key)) continue;
      const concept = c.conceptId ?? null;
      if (concept && (counts.get(concept) ?? 0) >= cap) continue;
      taken.add(key);
      out.push(c);
      progressed = true;
      if (concept) counts.set(concept, (counts.get(concept) ?? 0) + 1);
    }
    // 한 바퀴에 하나도 못 담았으면 남은 것이 전부 상한에 걸린 것 — 상한을 올린다.
    if (!progressed) cap++;
  }
  return out;
}

// 후보에서 limit개를 뽑는다.
//
// **안 풀어 본 문항을 먼저** 낸다(seenKeys = 이 사용자가 CBT·복습·섞어풀기 어디서든
// 한 번이라도 채점받은 문항). 기출 섞어풀기의 목적이 "새 문제를 만나는 것"이라, 이미
// 푼 문항이 섞이면 회독 효과와 헷갈린다. 새 문항이 모자랄 때만 푼 문항으로 채우고,
// 그때는 결과 화면이 "다 푼 과목"임을 알려준다(coveredAll).
//
// 두 그룹 안에서는 각각 문제지 라운드로빈 순서로 늘어놓아 시행처·연도가 자연히 섞이고,
// 그 순서 위에서 **같은 개념이 겹치지 않게**(takeSpreadByConcept) 담는다 — 20문항에
// "처분성"이 넷 들어오면 그날 공부는 한 개념 복습이 된다. 뽑은 목록은 마지막에 한 번
// 더 섞어, 세션 앞쪽이 전부 새 문항·뒤쪽이 전부 푼 문항으로 갈리지 않게 한다.
export function pickMixQuestions<T extends MixCandidate>(
  candidates: T[],
  limit: number,
  seenKeys: ReadonlySet<string> = new Set(),
  rand: () => number = Math.random,
): { picked: T[]; unseenCount: number; coveredAll: boolean } {
  const cap = Math.max(0, Math.floor(limit));
  const unseen: T[] = [];
  const seen: T[] = [];
  for (const c of candidates) {
    (seenKeys.has(mixCandidateKey(c)) ? seen : unseen).push(c);
  }

  const conceptCounts = new Map<string, number>();
  const fresh = takeSpreadByConcept(
    roundRobinByPaper(unseen, unseen.length, rand),
    cap,
    conceptCounts,
  );
  const filler =
    fresh.length < cap
      ? takeSpreadByConcept(
          roundRobinByPaper(seen, seen.length, rand),
          cap - fresh.length,
          conceptCounts,
        )
      : [];

  return {
    picked: shuffleWith([...fresh, ...filler], rand),
    unseenCount: fresh.length,
    // 새 문항만으로 정원을 못 채웠다 = 이 과목의 (풀 수 있는) 기출을 전부 만났다.
    coveredAll: unseen.length < cap,
  };
}

// 오답노트에 남는 이름: "9월 5일 섞어풀기". 같은 날 두 번째부터는 "(2)"를 붙여
// 구분한다 — 날짜만으로는 카드가 똑같이 보여 어느 쪽이 방금 푼 것인지 알 수 없다.
// 날짜는 한국 시간 기준이다(서버는 UTC 라 자정 근처에서 하루가 어긋난다).
export function mixSessionTitle(createdAt: Date | string, ordinal = 1): string {
  const d = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  if (Number.isNaN(d.getTime())) return "섞어풀기";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KST_TIME_ZONE,
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const base = `${month}월 ${day}일 섞어풀기`;
  return ordinal > 1 ? `${base} (${ordinal})` : base;
}

// 세션 목록(오래된 순 정렬 무관)에 같은 날 순번을 매겨 제목을 붙인다. 순번은 그날
// 안에서 만든 순서(created_at 오름차순)라, 목록을 최신순으로 보여줘도 "(2)"가 나중
// 것이다.
export function labelMixSessions<T extends { id: string; createdAt: string }>(
  sessions: T[],
  dayKey: (iso: string) => string,
): Map<string, string> {
  const sorted = [...sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const countByDay = new Map<string, number>();
  const titles = new Map<string, string>();
  for (const s of sorted) {
    const key = dayKey(s.createdAt);
    const n = (countByDay.get(key) ?? 0) + 1;
    countByDay.set(key, n);
    titles.set(s.id, mixSessionTitle(s.createdAt, n));
  }
  return titles;
}
