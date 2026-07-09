import { isChoseongQuery, matchesChoseong } from "@/lib/hangul";
import type { Subject } from "@/lib/supabase/types";

// 홈 화면 카드 렌더링/필터링/정렬에 필요한 필드만 담은 가벼운 문제지 타입.
// 전체 목록을 클라이언트에 통째로 보내는 방식이라 필드를 최소로 유지한다
// (풀 ExamPaper에는 이 검색·목록에 안 쓰는 필드도 많다).
export type LightPaper = {
  id: string;
  title: string;
  level: string | null;
  year: number;
  round: number;
  subject_id: string;
  exam_type_id: string;
  subjects: { id: string; name: string; slug: string } | null;
};

// 검색어와 매치되는 과목 id 목록을 계산한다. 서버(page.tsx)와 클라이언트
// (home-exam-browser.tsx) 양쪽에서 똑같은 로직을 써야 첫 렌더(SSR)와 이후
// 클라이언트 필터링 결과가 어긋나지 않는다.
export function matchSubjectIds(subjects: Subject[], rawQuery: string): string[] {
  const trimmedQuery = rawQuery.trim();
  if (!trimmedQuery) return [];

  if (isChoseongQuery(trimmedQuery)) {
    return subjects
      .filter((s) => matchesChoseong(s.name, trimmedQuery))
      .map((s) => s.id);
  }

  const lowerQuery = trimmedQuery.toLowerCase();
  // 단어 중간에 우연히 검색어가 들어가는 과목까지 그냥 다 보여주면("국어" 검색 시
  // "중국어"까지 나오는 식) 헷갈리니, 이름이 검색어로 시작하는 과목이 하나라도
  // 있으면 그것만 보여준다. 그런 과목이 하나도 없을 때만("법"으로 형법·민법을
  // 찾는 경우처럼 검색어가 단어 뒷부분에 있는 경우) 단어 중간 포함까지 넓힌다.
  const prefixMatches = subjects.filter((s) =>
    s.name.toLowerCase().startsWith(lowerQuery),
  );
  return (
    prefixMatches.length > 0
      ? prefixMatches
      : subjects.filter((s) => s.name.toLowerCase().includes(lowerQuery))
  ).map((s) => s.id);
}

export function filterPapers(
  papers: LightPaper[],
  {
    level,
    matchedSubjectIds,
    isSearching,
    favOnly,
    bookmarkedSubjectIds,
  }: {
    level?: string;
    matchedSubjectIds: string[];
    isSearching: boolean;
    // "즐겨찾기한 과목만 보기" 토글 상태. true면 즐겨찾기한 과목의 문제지만 남긴다.
    favOnly?: boolean;
    bookmarkedSubjectIds?: Set<string>;
  },
): LightPaper[] {
  return papers.filter((p) => {
    if (level && p.level !== level) return false;
    if (isSearching && !matchedSubjectIds.includes(p.subject_id)) return false;
    if (favOnly && !bookmarkedSubjectIds?.has(p.subject_id)) return false;
    return true;
  });
}

// "즐겨찾기한 과목만 보기" 화면은 연도 내림차순 → 같은 연도 안에서는 과목명
// 가나다순으로 묶어서 보여준다. 같은 연도·과목 안에서는 papers가 이미 정렬돼
// 들어온 순서(fetchAllExamPapers의 시행 시기 순)를 그대로 유지한다(안정 정렬).
export function groupByYearAndSubject(
  papers: LightPaper[],
): Map<number, Map<string, LightPaper[]>> {
  const sorted = [...papers].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return (a.subjects?.name ?? "").localeCompare(b.subjects?.name ?? "", "ko");
  });

  const byYear = new Map<number, Map<string, LightPaper[]>>();
  for (const paper of sorted) {
    if (!byYear.has(paper.year)) byYear.set(paper.year, new Map());
    const bySubject = byYear.get(paper.year)!;
    const subjectName = paper.subjects?.name ?? "기타";
    if (!bySubject.has(subjectName)) bySubject.set(subjectName, []);
    bySubject.get(subjectName)!.push(paper);
  }
  return byYear;
}
