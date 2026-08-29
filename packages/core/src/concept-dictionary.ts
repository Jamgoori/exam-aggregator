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
import { compareKo } from "./collate";

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

  return [...groups.values()].sort((a, b) => b.count - a.count || compareKo(a.key, b.key));
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
  // 자기 종류의 상한을 넘긴 개념들. 기능형은 상한이 느슨하다(빈칸추론이 시험지의
  // 절반을 차지해도 그건 시험이 그런 것이지 사전이 잘못된 게 아니다).
  overSizedConcepts: { conceptId: string; kind: ConceptKind; share: number }[];
  // 개념별 문항 수(많은 순).
  distribution: { conceptId: string; count: number }[];
};

// 진단이 성립하려면 개념당 이 정도 문항은 있어야 한다. 사용자가 한 과목에서 틀리는
// 문항이 20~50개인데, 그중 한 개념에서 서너 개는 틀려야 "이 개념이 약하다"고 말할 수
// 있다. 코퍼스 기준으로 이보다 얇은 개념은 상위로 흡수하는 게 맞다.
export const CONCEPT_MIN_QUESTIONS = 3;

// 개념 종류.
//
//   knowledge — 지식형. 모르면 틀리고 배우면 맞는다(대칭키 암호, 사동·피동)
//   skill     — 기능형. 묻는 능력이다(빈칸추론, 세부내용 일치)
//
// 국어 비문학·영어 독해는 지문이 재출제되지 않아 지식 개념이 성립하지 않는다.
// "조선 후기 상업의 발달"을 개념으로 세우면 문항이 한둘뿐이고, 사용자에게
// "그 지문이 약합니다"라고 말해봐야 쓸모가 없다. 그래서 묻는 능력으로 묶는다.
//
// 과목이 아니라 문항 성격으로 갈린다 — 국어에도 지식형(음운변동)이 많고, 영어
// 어법도 지식형이다.
export type ConceptKind = "knowledge" | "skill";

// 한 개념이 과목에서 차지해도 되는 최대 비율.
//
// 지식형이 20%를 넘으면 입도가 거친 것이다(쪼개야 한다). 기능형은 그게 정상이다 —
// 영어 빈칸추론은 실제로 시험지의 그 비중을 차지한다.
export const CONCEPT_MAX_SHARE_BY_KIND: Record<ConceptKind, number> = {
  knowledge: 0.2,
  skill: 0.5,
};

export function summarizeConceptHealth(
  matches: ConceptMatch[],
  conceptCount: number,
  minQuestions: number = CONCEPT_MIN_QUESTIONS,
  // 개념 종류. 안 주면 전부 지식형으로 본다.
  kindOf: (conceptId: string) => ConceptKind = () => "knowledge",
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

  const overSizedConcepts = distribution
    .map((d) => {
      const kind = kindOf(d.conceptId);
      return { conceptId: d.conceptId, kind, share: matched === 0 ? 0 : d.count / matched };
    })
    .filter((d) => d.share > CONCEPT_MAX_SHARE_BY_KIND[d.kind]);

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
    overSizedConcepts,
    distribution,
  };
}

// ── 정본 목록 검증 ───────────────────────────────────────────────────────────

export type ConceptSpecEntry = {
  name: string;
  unit?: string;
  kind?: string;
  aliases?: (string | TitleCount)[];
};

export type ConceptSpecIssue = { subject: string; message: string };

export type ConceptSpecReport = {
  // 고치지 않으면 등록 자체가 실패하거나 데이터가 어긋나는 것들.
  errors: ConceptSpecIssue[];
  // 등록은 되지만 사람이 봐야 하는 것들.
  warnings: ConceptSpecIssue[];
  stats: { subject: string; concepts: number; units: number; skills: number }[];
};

// 목록을 DB에 넣기 전에 본다. 별칭 유일 제약(concept_aliases_subject_normalized_uidx)에
// 걸리면 등록이 중간에 멈추고, 그 상태로 백필하면 일부 문항만 붙은 채로 남는다.
//
// 별칭은 과목 안에서만 유일하다. 독해 기능형은 과목마다 같은 이름을 쓴다("빈칸 추론"이
// 국어에도 영어에도 있다) — 그건 정상이고, 막으면 이름에 과목 접두를 붙이게 된다.
export function validateConceptSpec(
  spec: Record<string, ConceptSpecEntry[]>,
  minQuestions: number = CONCEPT_MIN_QUESTIONS,
): ConceptSpecReport {
  const errors: ConceptSpecIssue[] = [];
  const warnings: ConceptSpecIssue[] = [];
  const stats: ConceptSpecReport["stats"] = [];

  // 별칭은 과목 안에서 유일하다(DB 제약이 그렇다). 과목이 다르면 같은 별칭이 있어도
  // 된다 — 국어 "내용 일치"와 영어 "내용 일치"는 서로 다른 개념이다.
  const aliasOwner = new Map<string, string>();

  for (const [subject, entries] of Object.entries(spec)) {
    if (!Array.isArray(entries)) continue;

    const names = new Set<string>();
    const keyOwners = new Map<string, string[]>();
    const units = new Set<string>();
    let skills = 0;

    for (const entry of entries) {
      if (!entry?.name?.trim()) {
        errors.push({ subject, message: "이름이 빈 항목이 있다" });
        continue;
      }
      const name = entry.name.trim();

      if (names.has(name)) {
        errors.push({ subject, message: `이름이 중복된다: ${name}` });
      }
      names.add(name);

      if (entry.kind && entry.kind !== "knowledge" && entry.kind !== "skill") {
        errors.push({ subject, message: `kind 값이 이상하다: ${name} → ${entry.kind}` });
      }
      if (entry.kind === "skill") skills++;
      if (entry.unit) units.add(entry.unit);

      const aliases = [name, ...(entry.aliases ?? [])].map((a) =>
        typeof a === "string" ? a : a.title,
      );
      if (aliases.length === 1) {
        warnings.push({
          subject,
          message: `별칭이 없다: ${name} (코퍼스 표기를 합치기 전이라면 정상)`,
        });
      }

      for (const alias of aliases) {
        const normalized = normalizeConceptAlias(alias);
        if (!normalized) continue;
        const scoped = `${subject}\u0000${normalized}`;
        const owner = aliasOwner.get(scoped);
        if (owner && owner !== name) {
          errors.push({
            subject,
            message: `같은 과목 안에서 별칭이 겹친다: "${alias}" → ${name} / ${owner}`,
          });
          continue;
        }
        aliasOwner.set(scoped, name);
      }

      const key = conceptKeyOf(name);
      if (key) {
        const owners = keyOwners.get(key) ?? [];
        owners.push(name);
        keyOwners.set(key, owners);
      }
    }

    // 단원도 concepts 행이라 이름이 겹치면 유일 인덱스에 걸린다. 등록할 때 둘 중
    // 하나가 조용히 빠지고, 그러면 그 개념이 통째로 사라진 채 아무 표시도 안 난다.
    for (const unit of units) {
      if (names.has(unit)) {
        errors.push({ subject, message: `단원과 개념 이름이 같다: ${unit}` });
      }
    }

    // 같은 그룹 키를 나눠 가지면 2차 그물이 꺼진다(새 표기가 전부 미매칭이 된다).
    for (const [key, owners] of keyOwners) {
      if (owners.length > 1) {
        warnings.push({
          subject,
          message: `그룹 키 "${key}" 를 ${owners.join(", ")} 가 나눠 갖는다 — 새 표기는 별칭으로만 붙는다`,
        });
      }
    }

    // 입도 목표. 진단이 성립하는 최소 표본에서 역산한 값이다.
    if (entries.length > 0 && entries.length < 5) {
      warnings.push({ subject, message: `개념이 ${entries.length}개뿐 — 너무 거칠다` });
    }
    if (entries.length > 40) {
      warnings.push({
        subject,
        message: `개념이 ${entries.length}개 — 개념당 문항 ${minQuestions}개를 못 채울 수 있다`,
      });
    }
    if (units.size > 12) {
      warnings.push({ subject, message: `단원이 ${units.size}개 — 5~10개가 적당하다` });
    }

    stats.push({ subject, concepts: entries.length, units: units.size, skills });
  }

  return { errors, warnings, stats };
}
