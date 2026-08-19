import { getSubjectDisplayName, type Subject } from "@gongmoa/core";

// matchSubjectIds / parseSearchQuery 는 @gongmoa/core 로 단일화(모바일과 공유). 재노출.
export { matchSubjectIds, parseSearchQuery } from "@gongmoa/core";

// 홈 화면 카드 렌더링/필터링/정렬에 필요한 필드만 담은 가벼운 문제지 타입.
// 전체 목록을 클라이언트에 통째로 보내는 방식이라 필드를 최소로 유지한다
// (풀 ExamPaper에는 이 검색·목록에 안 쓰는 필드도 많다).
export type PaperCore = {
  id: string;
  title: string;
  level: string | null;
  // 중복 시험지(같은 시험지를 직류만 다르게 올린 것)를 목록에서 하나로 합칠 때,
  // 대표로 남긴 카드의 title에서 " (전산서기보)" 같은 접미사를 떼기 위해 필요하다.
  track: string | null;
  year: number;
  round: number;
  subject_id: string;
  exam_type_id: string;
};

// 화면에서 실제로 쓰는 형태 — 과목·시행처 객체가 붙어 있다. 서버가 이 모양
// 그대로 보내면 과목(163개)·시행처(14개) 객체가 문제지 행마다 복사돼 전송량이
// 두 배 이상으로 불어나므로, 전송은 아래 PaperWire로 하고 클라이언트에서
// decodePapers로 이 모양을 복원한다.
export type LightPaper = PaperCore & {
  subjects: { id: string; name: string; slug: string } | null;
  exam_types: { id: string; name: string } | null;
};

// 서버 → 클라이언트 전송용 압축 표현.
//
// 왜 튜플인가: 홈은 문제지 전체 목록(2026-07 기준 3383건)을 클라이언트로 통째로
// 넘겨 브라우저에서 즉시 검색·필터하는 구조다. 키 이름과 중첩 객체를 그대로
// 실어보내면 RSC 페이로드가 1.3MB까지 커져서, 서버 직렬화와 브라우저 파싱이
// 첫 로딩을 눈에 띄게 늦춘다. 키 이름을 없애고 과목·시행처를 각각의 배열
// 인덱스로 대체하면 같은 정보가 약 1/4 크기로 줄어든다.
//
// 순서: [id, title, level, track, year, round, subjectIdx, examTypeIdx]
// subjectIdx/examTypeIdx는 HomePayload.subjects / HomePayload.examTypes의 인덱스이며,
// 대응하는 행이 없으면 -1이다.
export type PaperWire = [
  string,
  string,
  string | null,
  string | null,
  number,
  number,
  number,
  number,
];

export type ExamTypeRef = { id: string; name: string };

export type HomePayload = {
  subjects: Subject[];
  examTypes: ExamTypeRef[];
  papers: PaperWire[];
};

export function encodePapers(
  papers: PaperCore[],
  subjects: Subject[],
  examTypes: ExamTypeRef[],
): PaperWire[] {
  const subjectIdx = new Map(subjects.map((s, i) => [s.id, i]));
  const examTypeIdx = new Map(examTypes.map((t, i) => [t.id, i]));
  return papers.map((p) => [
    p.id,
    p.title,
    p.level,
    p.track,
    p.year,
    p.round,
    subjectIdx.get(p.subject_id) ?? -1,
    examTypeIdx.get(p.exam_type_id) ?? -1,
  ]);
}

// 압축 표현을 화면용 LightPaper로 되돌린다. 과목·시행처는 "복사"하지 않고 같은
// 객체를 여러 문제지가 함께 가리키게 하므로(163+14개만 존재), 복원 비용은
// 배열 순회 한 번 수준이다.
export function decodePapers({ subjects, examTypes, papers }: HomePayload): LightPaper[] {
  const subjectRefs = subjects.map((s) => ({ id: s.id, name: s.name, slug: s.slug }));
  return papers.map(
    ([id, title, level, track, year, round, sIdx, tIdx]): LightPaper => ({
      id,
      title,
      level,
      track,
      year,
      round,
      subject_id: subjects[sIdx]?.id ?? "",
      exam_type_id: examTypes[tIdx]?.id ?? "",
      subjects: subjectRefs[sIdx] ?? null,
      exam_types: examTypes[tIdx] ?? null,
    }),
  );
}

// papers에 실제로 등장하는 시행처(exam_types.name) 집합을 뽑는다. "국가직",
// "경찰"처럼 검색어 토큰과 정확히 일치할 때만 매칭에 쓸 후보 목록이라, DB에 없는
// 이름을 오매칭할 일이 없다.
export function getExamTypeNames(papers: LightPaper[]): string[] {
  const set = new Set<string>();
  for (const p of papers) {
    if (p.exam_types?.name) set.add(p.exam_types.name);
  }
  return [...set];
}

export function filterPapers(
  papers: LightPaper[],
  {
    level,
    year,
    examType,
    matchedSubjectIds,
    isSearching,
    favOnly,
    bookmarkedSubjectIds,
  }: {
    level?: string;
    year?: number;
    examType?: string;
    matchedSubjectIds: string[];
    isSearching: boolean;
    // "즐겨찾기한 과목만 보기" 토글 상태. true면 즐겨찾기한 과목의 문제지만 남긴다.
    favOnly?: boolean;
    bookmarkedSubjectIds?: Set<string>;
  },
): LightPaper[] {
  return papers.filter((p) => {
    if (level && p.level !== level) return false;
    if (year && p.year !== year) return false;
    if (examType && p.exam_types?.name !== examType) return false;
    if (isSearching && !matchedSubjectIds.includes(p.subject_id)) return false;
    if (favOnly && !bookmarkedSubjectIds?.has(p.subject_id)) return false;
    return true;
  });
}

// 묶음 제목에 쓸 과목명. 문제지마다 시행처를 알고 있으므로 그 시행처가 쓰는 표기를
// 따른다 — 군무원 문제지는 "행정법"으로 묶이고 국가직·지방직은 "행정법총론"으로
// 묶여, 두 이름이 목록에 나란히 보인다(같은 과목 행이라 검색은 한 번에 걸린다).
function groupSubjectName(paper: LightPaper): string {
  const name = paper.subjects?.name;
  if (!name) return "기타";
  return getSubjectDisplayName(name, paper.exam_types?.name, paper.level, paper.track);
}

// "즐겨찾기한 과목만 보기" 화면은 연도 내림차순 → 같은 연도 안에서는 과목명
// 가나다순으로 묶어서 보여준다. 같은 연도·과목 안에서는 papers가 이미 정렬돼
// 들어온 순서(fetchAllExamPapers의 시행 시기 순)를 그대로 유지한다(안정 정렬).
export function groupByYearAndSubject(
  papers: LightPaper[],
): Map<number, Map<string, LightPaper[]>> {
  const sorted = [...papers].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return groupSubjectName(a).localeCompare(groupSubjectName(b), "ko");
  });

  const byYear = new Map<number, Map<string, LightPaper[]>>();
  for (const paper of sorted) {
    if (!byYear.has(paper.year)) byYear.set(paper.year, new Map());
    const bySubject = byYear.get(paper.year)!;
    const subjectName = groupSubjectName(paper);
    if (!bySubject.has(subjectName)) bySubject.set(subjectName, []);
    bySubject.get(subjectName)!.push(paper);
  }
  return byYear;
}
