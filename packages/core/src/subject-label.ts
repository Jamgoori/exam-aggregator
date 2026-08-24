import { isChoseongQuery, matchesChoseong } from "./hangul";

// 시행처마다 다른 과목 표기 — 웹·모바일 공유(순수 함수).
//
// DB `subjects` 는 과목 하나에 행 하나다. 그래서 같은 과목을 시행처가 다르게
// 부르면(군무원 "행정법"·"행정학" ↔ 국가직·지방직 "행정법총론"·"행정학개론")
// 한쪽 표기를 정본으로 골라야 하는데, `bulk-upload.mjs` 의 `SUBJECT_ALIASES` 가
// 시행처를 안 보고 국가직 표기로 통일해 버린다. 그 결과 군무원 문제지가
// "2026 군무원 9급 행정법총론"으로 저장됐다 — 실제 문제지 표지는 "행정법"이다.
//
// **과목 행을 쪼개지 않고 표시만 되돌린다.** 이유 둘:
//   - 개념 사전(`concepts`)이 과목 단위다. 행을 쪼개면 사전을 통째로 복제하고 이미
//     붙은 `concept_id` 를 새 id 로 옮겨야 하는데, 개념 id 재발급은 금지선이다
//     (`apps/web/docs/agents/concept-dictionary.md`). 실측 대상 26장에 이미 해설
//     300건·개념 연결 66건이 붙어 있다.
//   - 내용이 같은 과목이라 한 행으로 두는 편이 낫다. 군무원 수험생도 국가직·지방직
//     행정법총론 문제지를 같은 과목으로 이어서 풀고, "행정법"이 상위 개념이라
//     검색어 "행정법"에 총론까지 그대로 걸린다.
//
// `exam_papers.title` 은 손대지 않는다. 업로드 시점의 기록이고, 화면에 나갈 이름은
// 여기서만 정한다(직류 표기를 제목에서 떼는 `paper-title.ts` 와 같은 층).
//
// **키는 "시행처" 또는 "시행처 급수"** 다. 급수를 적은 쪽이 먼저 걸린다. 같은
// 시행처라도 급수마다 과목명이 갈리기 때문이다 — 문제지 1,163장 표본을 내려받아
// 머리글을 대조한 결과(2026-08, `npm run check-subject-names -- --pdf`):
//
//   국가직·지방직 9급   "행정법총론" · "행정학개론"   ← DB 이름이 맞다
//   국가직·지방직 7급   "행정법"     · "행정학"
//   국회직 8급          "행정법"     · "행정학"       (국회직 9급은 총론·개론)
//   경찰(급수 없음)     "행정법"     · "행정학"
//   경력경쟁 9급        "행정법"     · "행정학"
//   군무원 9급·7급      "행정법"     · "행정학"
//
// 어긋난 조합은 이 6종이 전부였다(표본 1,163장 중 1,087장 일치). 새로 넣을 때는
// 반드시 같은 방식으로 문제지를 직접 확인할 것 — 파일명은 축약형인 경우가 많다.
//
// 소방처럼 **같은 시행처 안에서 직류(track)마다 갈리는** 경우가 있어 키에
// "시행처 (직류)" 형태도 받는다. 소방 공채·경채 문제지는 머리글이 【행정법총론】
// 이지만, 간부후보생 선발시험은 【행 정 법】·【행정학】, 승진시험 소방위는
// 【행정법】이다 (2026-08-19 문제지 직접 확인). 시행처 전체에 거는 규칙으로 두면
// 공채 문제지까지 "행정법"으로 바뀐다.
const SUBJECT_NAME_BY_EXAM_TYPE: Record<string, Record<string, string>> = {
  군무원: { 행정법총론: "행정법", 행정학개론: "행정학" },
  "국가직 7급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  "지방직 7급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  "국회직 8급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  경찰: { 행정법총론: "행정법", 행정학개론: "행정학" },
  "경력경쟁 9급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  "소방 (간부후보)": { 행정법총론: "행정법", 행정학개론: "행정학" },
  "소방 (소방위 승진)": { 행정법총론: "행정법" },
};

// 직류까지 적힌 규칙 > 급수까지 적힌 규칙 > 시행처만 적힌 규칙.
function namesFor(
  examTypeName: string,
  level: string | null | undefined,
  track?: string | null,
): Record<string, string> | undefined {
  return (
    (track ? SUBJECT_NAME_BY_EXAM_TYPE[`${examTypeName} (${track})`] : undefined) ??
    (level ? SUBJECT_NAME_BY_EXAM_TYPE[`${examTypeName} ${level}`] : undefined) ??
    SUBJECT_NAME_BY_EXAM_TYPE[examTypeName]
  );
}

// DB 이름 → 그 과목을 달리 부르는 표기들(중복 없이). 위 표를 뒤집어 만든다 —
// 표에 한 줄 넣으면 여기도 따라오게 해서 두 목록이 어긋나지 않게.
const ALIASES_BY_STORED_NAME: Record<string, string[]> = (() => {
  const collected: Record<string, Set<string>> = {};
  for (const names of Object.values(SUBJECT_NAME_BY_EXAM_TYPE)) {
    for (const [stored, printed] of Object.entries(names)) {
      if (printed === stored) continue;
      (collected[stored] ??= new Set()).add(printed);
    }
  }
  return Object.fromEntries(
    Object.entries(collected).map(([stored, set]) => [stored, [...set]]),
  );
})();

// 그 과목을 부르는 이름 전부 — DB 이름이 언제나 첫 번째다.
export function getSubjectNameVariants(subjectName: string): string[] {
  return [subjectName, ...(ALIASES_BY_STORED_NAME[subjectName] ?? [])];
}

// 검색 추천처럼 "사용자가 방금 친 검색어" 옆에 과목 이름을 놓는 자리에서 쓸 표기.
//
// 홈 검색창에 "행정법"을 치면 추천에 "행정법총론"이 떴다. 매칭 자체는 맞다(접두
// 매칭이라 총론이 걸린다). 문제는 방금 친 이름이 그대로 있는데 화면이 다른 이름을
// 돌려주니, 찾는 과목이 없어서 비슷한 걸 보여준 것처럼 읽힌다는 것이다.
//
// 시행처별 표기(getSubjectDisplayName)와는 다른 함수인 이유: 이 자리에는 시행처가
// 없다. 판단 근거는 검색어 하나뿐이라, 그 과목을 부르는 이름들 중 검색어와 맞는
// 것을 고른다 — "행정법"으로 찾으면 "행정법", "행정법총론"으로 찾으면 "행정법총론".
// 어느 쪽을 눌러도 가는 곳은 같은 과목 페이지이고, 거기서는 DB 이름이 정본이다
// (docs/agents/subject-names.md — 여러 시행처가 섞이는 화면에는 표기를 걸지 않는다).
export function getSubjectNameForQuery(subjectName: string, rawQuery: string): string {
  const query = rawQuery.trim();
  const variants = getSubjectNameVariants(subjectName);
  if (!query || variants.length === 1) return subjectName;

  // 매칭 규칙은 과목 매칭(search.ts matchSubjectIds)과 같은 것을 쓴다 — 검색어로
  // 시작하거나, 초성 검색이면 초성이 포함되거나.
  const choseong = isChoseongQuery(query);
  const lower = query.toLowerCase();
  const matched = variants.filter((name) =>
    choseong ? matchesChoseong(name, query) : name.toLowerCase().startsWith(lower),
  );
  if (matched.length === 0) return subjectName;

  // 여럿이 걸리면 짧은 쪽 — 친 글자에 군더더기가 가장 적게 붙은 이름이다.
  return matched.reduce((shortest, name) =>
    name.length < shortest.length ? name : shortest,
  );
}

// 즐겨찾기 추가/편집 화면(전체 과목이 시행처 구분 없이 섞여 나오는 목록)에서 쓸 표기.
//
// 원래 규칙(subject-names.md)은 이런 화면엔 DB 정본 이름(9급 표기, 예: "행정학개론")을
// 그대로 쓰라고 되어 있다 — 시행처를 모르는 화면이라 어느 쪽으로 되돌릴지 정할 근거가
// 없기 때문이다. 다만 즐겨찾기 화면은 사용자가 요청해 예외로 짧은 표기(9급 외 시행처가
// 쓰는 이름)를 쓰기로 했다 — "행정학"을 즐겨찾아도 문제지는 여전히 같은 과목 행(DB
// 이름은 "행정학개론")으로 그대로 연결된다.
export function getSubjectShortName(subjectName: string): string {
  const variants = getSubjectNameVariants(subjectName);
  return variants.reduce((shortest, name) => (name.length < shortest.length ? name : shortest));
}

// 그 시행처가 실제로 쓰는 과목명. 예외가 없으면 DB 이름을 그대로 돌려준다.
// 시행처를 모르는 자리(과목 페이지·오답노트처럼 여러 시행처가 섞이는 화면)에서는
// 부르지 말 것 — 거기서는 DB 이름이 정본이다.
export function getSubjectDisplayName(
  subjectName: string,
  examTypeName: string | null | undefined,
  level?: string | null,
  track?: string | null,
): string {
  if (!examTypeName) return subjectName;
  return namesFor(examTypeName, level, track)?.[subjectName] ?? subjectName;
}

// 제목 안의 과목명을 그 시행처 표기로 되돌린다.
//
// 시행처·급수를 인자로 받지 않고 제목에서 읽는다. 제목은 업로드가
// `${연도} ${시행처}[ ${급수}][ (직류)] ${과목명}` 으로 만들어 둘째 토큰이 늘
// 시행처이고 셋째 토큰이 급수(없는 시행처도 있다 — "2012 경찰 공채 3차 …")이며,
// 이렇게 해야 제목만 들고 있는 호출부(카드·CBT·OG 이미지·RSS·모바일)를 전부
// 고치지 않아도 한 곳에서 규칙이 걸린다 — 한 군데라도 빠뜨리면 같은 문제지가
// 화면마다 다른 과목명으로 보인다.
export function applyExamTypeSubjectName(title: string): string {
  const [, examTypeName, third] = title.trim().split(/\s+/);
  const level = /^\d+급$/.test(third ?? "") ? third : null;
  // 직류는 제목에서 괄호로 감싸 들어온다("2026 소방 (간부후보) 행정법총론").
  // 소방처럼 직류마다 과목 표기가 갈리는 시행처를 위해 여기서 같이 읽는다.
  const track = title.match(/\(([^)]+)\)/)?.[1] ?? null;
  const names = examTypeName ? namesFor(examTypeName, level, track) : undefined;
  if (!names) return title;

  // 과목명은 제목 맨 뒤에 붙는다. 중간에 우연히 같은 글자가 있어도 건드리지 않는다.
  for (const [stored, printed] of Object.entries(names)) {
    if (title.endsWith(stored)) {
      return `${title.slice(0, title.length - stored.length)}${printed}`;
    }
  }
  return title;
}
