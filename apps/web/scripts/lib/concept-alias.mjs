// 개념 별칭 정규화 + 이름→concept_id 해석 (재분류 배치 공용).
//
// packages/core/src/concept-dictionary.ts 의 normalizeConceptAlias 와 같은 규칙이다.
// 사본을 두는 이유: 배치 스크립트는 루틴 환경에서 plain node 로 돌고, @gongmoa/core 는
// 빌드 산출물이 없는 TypeScript 소스라 import 할 수 없다.
//
// 이 규칙은 지금 세 곳에 있다 — core, scripts/save-explanations.mjs, 여기.
// 한 곳만 고치면 배치가 붙이는 개념과 백필이 붙이는 개념이 조용히 달라진다.
// src/lib/explanation-concepts.test.ts 가 세 구현이 어긋나면 실패한다.
//
// 사전을 빌려 쓰는 과목 표(CONCEPT_DICTIONARY_SOURCE_BY_SLUG)도 같은 이유로 사본이다
// — 그쪽은 next-explanation-chunk.mjs 까지 넷이다.

export function normalizeConceptAlias(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s·,、/()[\]{}<>"'“”‘’:;~\-–—.]/g, "");
}

// PostgREST 의 .in() 은 URL 길이 제한이 있어 나눠 던진다.
export async function selectIn(supabase, table, columns, column, values) {
  const rows = [];
  for (let i = 0; i < values.length; i += 200) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in(column, values.slice(i, i + 200));
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

// 한 과목의 별칭 색인. 별칭은 과목 안에서만 유일하다 — 국어 "내용 일치"와 영어
// "내용 일치"는 서로 다른 개념이고 둘 다 있어야 한다.
export async function loadAliasIndex(supabase, subjectId) {
  const byNormalized = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("concept_aliases")
      .select("concept_id, normalized")
      .eq("subject_id", subjectId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`별칭 조회 실패: ${error.message}`);
    for (const a of data ?? []) byNormalized.set(a.normalized, a.concept_id);
    if ((data?.length ?? 0) < PAGE) break;
  }
  return byNormalized;
}

// 배치가 고른 이름 하나를 정본 id 로 바꾼다.
//
// 못 붙이면 null 이고, 호출부는 그걸 미매칭으로 보고한다. "기타"로 뭉치지 않는다 —
// 뭉치는 순간 진단이 죽는다(docs/agents/concept-dictionary.md).
export function resolveConceptName(rawName, aliasIndex) {
  if (typeof rawName !== "string") return { conceptId: null, name: null, proposal: false };
  const raw = rawName.trim();
  if (!raw) return { conceptId: null, name: null, proposal: false };

  // "?" 접두는 "목록에 없어서 새로 제안한다"는 배치 쪽 표시다.
  const proposal = raw.startsWith("?");
  const name = raw.replace(/^\?+\s*/, "").trim();
  if (!name) return { conceptId: null, name: null, proposal };

  // "?"를 붙였어도 실제로 목록에 있으면 붙인다 — 이름이 맞으면 분포는 안 틀어진다.
  const conceptId = aliasIndex.get(normalizeConceptAlias(name)) ?? null;
  return { conceptId, name, proposal };
}

// 고를 수 있는 개념 목록. 단원과 합쳐진 개념은 뺀다.
//
// 단원도 concepts 행이라 컬럼으로는 안 갈린다. 자식이 달린 최상위 행이 단원이고,
// 자식이 없는 최상위 행은 "단원 없는 개념"이다 — 후자는 고를 수 있어야 한다.
export function shapeConceptList(rows) {
  const live = (rows ?? []).filter((r) => !r.merged_into);
  const nameById = new Map(live.map((r) => [r.id, r.name]));
  const hasChild = new Set(live.map((r) => r.parent_id).filter(Boolean));
  return live
    .filter((r) => !(r.parent_id === null && hasChild.has(r.id)))
    .map((r) => ({
      name: r.name,
      unit: r.parent_id ? (nameById.get(r.parent_id) ?? null) : null,
      kind: r.kind ?? "knowledge",
    }))
    .sort(
      (a, b) =>
        (a.unit ?? "").localeCompare(b.unit ?? "", "ko") || a.name.localeCompare(b.name, "ko"),
    );
}

// ── 사전을 빌려 쓰는 과목 ────────────────────────────────────────────────────
//
// packages/core/src/concept-dictionary.ts 의 CONCEPT_DICTIONARY_SOURCE_BY_SLUG 사본이다
// (이유는 위와 같다 — 루틴 환경은 plain node).
//
// 과목 행이 갈렸다고 개념까지 갈리는 건 아니다. 한능검은 문항 수·선지 수가 달라서
// 문제지 목록을 공무원 한국사와 섞을 수 없어 전용 과목 행을 쓰지만, 묻는 내용은 같은
// 한국사 통사다. 그래서 사전을 복제하지 않고 빌려 쓴다 — 복제하면 같은 개념이 id 둘로
// 갈려 진단 표본이 반씩 쪼개지고, 나중에 합치려면 개념 id 재발급(금지선)이 필요하다.
export const CONCEPT_DICTIONARY_SOURCE_BY_SLUG = {
  // 한국사능력검정시험 → 공무원 한국사
  "korean-history-exam": "korean-history",
};

// 과목 행들에서 "빌린 과목 id → 빌려준 과목 id" 를 만든다.
export function buildDictionarySubjectIds(subjects) {
  const idBySlug = new Map((subjects ?? []).filter((s) => s?.slug).map((s) => [s.slug, s.id]));
  const map = new Map();
  for (const [borrower, source] of Object.entries(CONCEPT_DICTIONARY_SOURCE_BY_SLUG)) {
    const borrowerId = idBySlug.get(borrower);
    const sourceId = idBySlug.get(source);
    if (borrowerId && sourceId && borrowerId !== sourceId) map.set(borrowerId, sourceId);
  }
  return map;
}

// DB 에서 그 표를 읽어 온다. 조회가 실패해도 던지지 않는다 — 빌림이 안 걸리면 그
// 과목만 예전처럼 "사전 없음"으로 보고될 뿐이고, 저장 자체를 막는 건 손해가 더 크다.
export async function loadDictionarySubjectIds(supabase) {
  const slugs = [
    ...new Set([
      ...Object.keys(CONCEPT_DICTIONARY_SOURCE_BY_SLUG),
      ...Object.values(CONCEPT_DICTIONARY_SOURCE_BY_SLUG),
    ]),
  ];
  const { data, error } = await supabase.from("subjects").select("id, slug").in("slug", slugs);
  if (error) {
    console.error(`사전 공유 과목 조회 실패 — 공유 없이 진행: ${error.message}`);
    return new Map();
  }
  return buildDictionarySubjectIds(data);
}

// 이 과목의 사전이 있는 곳. 빌리지 않는 과목은 자기 자신이다.
export function dictionarySubjectId(subjectId, dictionaryOf) {
  return dictionaryOf.get(subjectId) ?? subjectId;
}
