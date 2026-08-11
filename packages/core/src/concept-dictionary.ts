// 개념 사전 — keyword_title 을 정본 개념으로 접는 규칙(순수 계산).
//
// concept-key.ts 와 목적이 다르다. 그쪽은 "큐가 같은 개념으로 도배되지 않게" 하는
// 거친 축이고, 사전이 없어도 돌아가야 해서 문자열만 보고 대충 묶는다. 여기는 사람이
// 정리한 정본 목록(concepts 테이블)에 문항을 붙이는 자리다. 약점 진단("대칭키가
// 약합니다")이 이 축을 쓰게 되므로 틀리면 사용자에게 틀린 말을 하게 된다.
//
// 그래서 규칙이 반대다:
//   concept-key.ts — 모르면 대충이라도 묶는다(놓쳐도 손해가 작다)
//   여기          — 모르면 안 붙인다(미매칭으로 남겨 사람이 본다)
//
// 정본 이름 하나만 두면 다음 해설 배치분이 또 표류한다("대칭키 암호" 다음엔 "대칭키
// 암호화 방식"이 온다). 그래서 정본마다 별칭(alias)을 쌓고, 어디에도 안 붙는 것은
// 조용히 "기타"로 뭉치지 않고 미매칭으로 남긴다 — 뭉치는 순간 진단이 죽는다.

import { conceptKeyOf } from "./concept-key";

// 별칭 비교용 정규화. 표기 흔들림 중 "같은 글자인데 사이가 다른" 것만 지운다.
// 의미 있는 절단(꼬리말·파생 접미사)은 하지 않는다 — 그건 concept-key.ts 의 일이고,
// 여기서 같이 하면 다른 개념이 조용히 한 정본에 붙는다.
export function normalizeConceptAlias(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s·,、/()[\]{}<>"'“”‘’:;~\-–—.]/g, "");
}

// 문항 하나에 붙는 정본 개념. 못 붙이면 null 이고, 호출부는 그걸 미매칭으로 센다.
export type ConceptLookup = {
  // 정규화된 별칭 → 개념 id.
  byAlias: Map<string, string>;
  // concept-key 그룹 키 → 개념 id. 별칭에 없는 새 표기를 받아내는 2차 그물이다.
  // 한 그룹 키에 정본이 둘 이상 걸리면 그 키는 못 쓴다(어느 쪽인지 모른다).
  byConceptKey: Map<string, string>;
};

// 별칭 목록에서 조회용 색인을 만든다. 같은 그룹 키에 서로 다른 정본이 걸리면 그
// 키는 색인에서 뺀다 — 애매한 걸 찍어서 붙이면 진단이 조용히 틀린다.
export function buildConceptLookup(
  aliases: { conceptId: string; alias: string }[],
): ConceptLookup {
  const byAlias = new Map<string, string>();
  const keyOwners = new Map<string, Set<string>>();

  for (const { conceptId, alias } of aliases) {
    const normalized = normalizeConceptAlias(alias);
    if (normalized) byAlias.set(normalized, conceptId);

    const key = conceptKeyOf(alias);
    if (!key) continue;
    const owners = keyOwners.get(key) ?? new Set<string>();
    owners.add(conceptId);
    keyOwners.set(key, owners);
  }

  const byConceptKey = new Map<string, string>();
  for (const [key, owners] of keyOwners) {
    if (owners.size === 1) byConceptKey.set(key, [...owners][0]);
  }

  return { byAlias, byConceptKey };
}

export type ConceptMatch = {
  conceptId: string | null;
  // 어떻게 붙었는지. 검증 리포트가 "2차 그물로만 붙은 비율"을 봐야 별칭을 언제
  // 보강할지 알 수 있다.
  via: "alias" | "key" | "none";
};

// 제목 하나를 정본에 붙인다. 별칭이 먼저고, 없으면 그룹 키로 한 번 더 본다.
export function matchConcept(
  keywordTitle: string | null | undefined,
  lookup: ConceptLookup,
): ConceptMatch {
  if (!keywordTitle?.trim()) return { conceptId: null, via: "none" };

  const byAlias = lookup.byAlias.get(normalizeConceptAlias(keywordTitle));
  if (byAlias) return { conceptId: byAlias, via: "alias" };

  const key = conceptKeyOf(keywordTitle);
  const byKey = key ? lookup.byConceptKey.get(key) : undefined;
  if (byKey) return { conceptId: byKey, via: "key" };

  return { conceptId: null, via: "none" };
}

// ── 정본 목록 초안 ───────────────────────────────────────────────────────────

export type TitleCount = { title: string; count: number };

export type ConceptDraft = {
  // concept-key 그룹 키. 초안을 다시 만들어도 같은 묶음이 같은 키를 갖는다.
  key: string;
  // 정본 이름 후보 = 그 묶음에서 가장 많이 쓰인 표기. 사람이 고칠 값이다.
  name: string;
  // 이 묶음에 속한 문항 수 합계. 개념 입도를 판단하는 근거다 — 문항이 두세 개뿐인
  // 개념은 진단 표본이 안 나오므로 상위(단원)로 흡수해야 한다.
  count: number;
  // 원래 표기들. 그대로 별칭이 된다.
  aliases: TitleCount[];
};

// keyword_title 빈도 목록에서 정본 초안을 만든다.
//
// 자동으로 확정하지 않는다. 사람이 쪼개고 합치라고 내놓는 초안이다 — 그룹 키는
// "제목의 첫 의미 토큰"이라 "행정행위의 하자"와 "행정행위의 취소"를 한 묶음으로
// 낸다. 큐 다양성에는 그게 맞지만 진단 축으로는 쪼개야 한다.
export function buildConceptDrafts(titles: TitleCount[]): ConceptDraft[] {
  const groups = new Map<string, ConceptDraft>();

  for (const item of titles) {
    const key = conceptKeyOf(item.title);
    if (!key) continue;
    const draft = groups.get(key) ?? { key, name: item.title, count: 0, aliases: [] };
    draft.count += item.count;
    draft.aliases.push(item);
    groups.set(key, draft);
  }

  for (const draft of groups.values()) {
    // 이름 후보는 가장 많이 쓰인 표기. 같은 횟수면 짧은 쪽(수식어가 덜 붙은 쪽).
    draft.aliases.sort((a, b) => b.count - a.count || a.title.length - b.title.length);
    draft.name = draft.aliases[0].title;
  }

  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "ko"));
}

// ── 검증 ─────────────────────────────────────────────────────────────────────

export type ConceptHealth = {
  concepts: number;
  questions: number;
  matched: number;
  // 별칭으로 붙은 것 / 그룹 키(2차 그물)로 붙은 것.
  viaAlias: number;
  viaKey: number;
  unmatched: number;
  coverage: number;
  // 문항이 얼마 없는 개념 수와 비율. 진단 표본이 안 나오는 구간이다.
  thinConcepts: number;
  thinRatio: number;
  // 한 개념이 차지한 최대 비율. 너무 크면 입도가 거칠다.
  maxConceptShare: number;
  // 개념별 문항 수(많은 순).
  distribution: { conceptId: string; count: number }[];
};

// 진단이 성립하려면 개념당 이 정도 문항은 있어야 한다. 사용자가 한 과목에서 틀리는
// 문항이 20~50개인데, 그중 한 개념에서 서너 개는 틀려야 "이 개념이 약하다"고 말할 수
// 있다. 코퍼스 기준으로 이보다 얇은 개념은 상위로 흡수하는 게 맞다.
export const CONCEPT_MIN_QUESTIONS = 3;

export function summarizeConceptHealth(
  matches: ConceptMatch[],
  conceptCount: number,
  minQuestions: number = CONCEPT_MIN_QUESTIONS,
): ConceptHealth {
  const perConcept = new Map<string, number>();
  let viaAlias = 0;
  let viaKey = 0;

  for (const m of matches) {
    if (m.via === "alias") viaAlias++;
    if (m.via === "key") viaKey++;
    if (!m.conceptId) continue;
    perConcept.set(m.conceptId, (perConcept.get(m.conceptId) ?? 0) + 1);
  }

  const matched = viaAlias + viaKey;
  const distribution = [...perConcept.entries()]
    .map(([conceptId, count]) => ({ conceptId, count }))
    .sort((a, b) => b.count - a.count);
  const thinConcepts = distribution.filter((d) => d.count < minQuestions).length;

  return {
    concepts: conceptCount,
    questions: matches.length,
    matched,
    viaAlias,
    viaKey,
    unmatched: matches.length - matched,
    coverage: matches.length === 0 ? 0 : matched / matches.length,
    thinConcepts,
    thinRatio: distribution.length === 0 ? 0 : thinConcepts / distribution.length,
    maxConceptShare: matched === 0 ? 0 : (distribution[0]?.count ?? 0) / matched,
    distribution,
  };
}
