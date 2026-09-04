import {
  getSubjectNameForQuery,
  matchSubjectIds,
  parseSearchQuery,
  type Subject,
} from "@gongmoa/core";
import type { SearchSuggestion } from "@/components/search-suggestions";

/** 추천에 필요한 최소 정보. 홈은 과목 인덱스(lib/subject-index)에서 이 모양으로 받는다. */
export type SuggestibleSubject = { slug: string; name: string };

// 스크롤 없이 훑을 수 있는 개수. 검색어를 더 좁히면 자연히 줄어든다.
// (기출문제 목록의 추천도 같은 6개 — exam-browser.tsx)
export const SUBJECT_SUGGESTION_LIMIT = 6;

// 검색어로 뜰 과목 추천 목록.
//
// 기출문제 목록(/papers)에서는 카드 그리드를 거르는 데 쓴 matchedSubjectIds를 그대로
// 잘라 추천으로 쓰지만(둘이 항상 같은 목록이어야 한다), 홈에는 거를 카드가 없어 이
// 함수가 같은 규칙(parseSearchQuery → matchSubjectIds)을 다시 밟는다. 규칙 자체는
// @gongmoa/core 한 곳에만 있으므로 두 화면의 추천 결과는 서로 어긋나지 않는다.
export function getSubjectSuggestions(
  subjects: SuggestibleSubject[],
  rawQuery: string,
  examTypeNames: string[],
): SearchSuggestion[] {
  // "2025 국가직 행정법"처럼 연도·급수·시행처가 섞여 있어도 과목명 부분만 뽑아 쓴다.
  const { subjectQuery } = parseSearchQuery(rawQuery, examTypeNames);
  if (!subjectQuery.trim()) return [];

  // matchSubjectIds는 id로 결과를 돌려주는데(문제지-과목 연결에 쓰는 값), 홈에는
  // 과목 id가 없고 필요하지도 않다 — 자리 번호를 id 삼아 넘기고 그대로 되찾는다.
  const rows: Subject[] = subjects.map((s, i) => ({
    id: String(i),
    slug: s.slug,
    name: s.name,
    display_order: i,
  }));
  return matchSubjectIds(rows, subjectQuery)
    .slice(0, SUBJECT_SUGGESTION_LIMIT)
    .map((id) => rows[Number(id)])
    .map((s) => ({
      slug: s.slug,
      // 보여주는 이름은 방금 친 검색어에 맞춘다 — "행정법"을 쳤는데 추천이
      // "행정법총론"으로 뜨면 찾는 과목이 없어서 비슷한 걸 내준 것처럼 읽힌다.
      name: getSubjectNameForQuery(s.name, subjectQuery),
    }));
}
