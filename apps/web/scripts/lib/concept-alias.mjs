// 개념 별칭 정규화 + 이름→concept_id 해석 (재분류 배치 공용).
//
// packages/core/src/concept-dictionary.ts 의 normalizeConceptAlias 와 같은 규칙이다.
// 사본을 두는 이유: 배치 스크립트는 루틴 환경에서 plain node 로 돌고, @gongmoa/core 는
// 빌드 산출물이 없는 TypeScript 소스라 import 할 수 없다.
//
// 이 규칙은 지금 세 곳에 있다 — core, scripts/save-explanations.mjs, 여기.
// 한 곳만 고치면 배치가 붙이는 개념과 백필이 붙이는 개념이 조용히 달라진다.
// src/lib/explanation-concepts.test.ts 가 세 구현이 어긋나면 실패한다.

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
