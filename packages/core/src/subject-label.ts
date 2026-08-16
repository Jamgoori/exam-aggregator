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
const SUBJECT_NAME_BY_EXAM_TYPE: Record<string, Record<string, string>> = {
  군무원: { 행정법총론: "행정법", 행정학개론: "행정학" },
  "국가직 7급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  "지방직 7급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  "국회직 8급": { 행정법총론: "행정법", 행정학개론: "행정학" },
  경찰: { 행정법총론: "행정법", 행정학개론: "행정학" },
  "경력경쟁 9급": { 행정법총론: "행정법", 행정학개론: "행정학" },
};

// 급수까지 적힌 규칙이 시행처만 적힌 규칙을 이긴다.
function namesFor(
  examTypeName: string,
  level: string | null | undefined,
): Record<string, string> | undefined {
  return (
    (level ? SUBJECT_NAME_BY_EXAM_TYPE[`${examTypeName} ${level}`] : undefined) ??
    SUBJECT_NAME_BY_EXAM_TYPE[examTypeName]
  );
}

// 그 시행처가 실제로 쓰는 과목명. 예외가 없으면 DB 이름을 그대로 돌려준다.
// 시행처를 모르는 자리(과목 페이지·오답노트처럼 여러 시행처가 섞이는 화면)에서는
// 부르지 말 것 — 거기서는 DB 이름이 정본이다.
export function getSubjectDisplayName(
  subjectName: string,
  examTypeName: string | null | undefined,
  level?: string | null,
): string {
  if (!examTypeName) return subjectName;
  return namesFor(examTypeName, level)?.[subjectName] ?? subjectName;
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
  const names = examTypeName ? namesFor(examTypeName, level) : undefined;
  if (!names) return title;

  // 과목명은 제목 맨 뒤에 붙는다. 중간에 우연히 같은 글자가 있어도 건드리지 않는다.
  for (const [stored, printed] of Object.entries(names)) {
    if (title.endsWith(stored)) {
      return `${title.slice(0, title.length - stored.length)}${printed}`;
    }
  }
  return title;
}
