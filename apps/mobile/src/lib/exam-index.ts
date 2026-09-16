import { comboSlug, type LightPaper } from "@gongmoa/core";

// 시험 허브(`/exams`, `/exams/[exam]`)가 쓰는 순수 계산 — 웹 apps/web/src/lib/exam-index.ts 의
// 링크 규칙·문제지 수집·정렬부와 같은 규칙이다.
//
// 조합 집계(getExamIndex 의 acc 루프)는 이미 core `data/home.ts buildExamIndex` 에 있으므로
// 여기서 다시 만들지 않는다. 여기 남은 것은 core 에 아직 없는 두 가지뿐이다:
//   (1) 주소 만들기(examHref·examYearHref) — 웹과 같은 인코딩 규칙.
//   (2) 한 조합의 문제지 모으기·정렬(collectComboPapers·compareSubjectNames).
// **나중에 core 로 옮길 것**(이번 라운드는 `packages/core` 를 건드리지 않는다) — 웹이 같은
// 계산을 `lib/exam-index.ts` 에 들고 있어 두 벌이다. core `data/home.ts` 로 올리면 웹도
// re-export 한 줄로 끝난다.

// 한글이 섞인 슬러그라 링크·딥링크 어디서든 반드시 인코딩해서 쓴다(웹과 같은 규칙 —
// 한쪽만 인코딩하면 앱 라우트 경로와 웹 URL 이 갈라진다).
export function examHref(slug: string): string {
  return `/exams/${encodeURIComponent(slug)}`;
}

// 연도는 별도 주소가 아니라 같은 화면의 필터다(웹 주석: 시험 18개 × 연도 14년 =
// 250장짜리 페이지 무더기를 만들지 않는다). 정본은 언제나 연도 없는 주소다.
export function examYearHref(slug: string, year: number): string {
  return `${examHref(slug)}?year=${year}`;
}

// 거의 모든 수험생이 치는 필수과목. 순수 가나다순으로 두면 "건축계획"이 맨 앞에 오고
// 국어·영어·한국사가 목록 한가운데 묻힌다(웹 CORE_SUBJECTS 와 같은 배열).
const CORE_SUBJECTS = ["국어", "영어", "한국사"];

export function compareSubjectNames(a: string, b: string): number {
  const ai = CORE_SUBJECTS.indexOf(a);
  const bi = CORE_SUBJECTS.indexOf(b);
  if (ai !== -1 || bi !== -1) {
    // 한쪽만 필수과목이면 그쪽이 앞, 둘 다면 위 배열 순서를 따른다.
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }
  return a.localeCompare(b, "ko");
}

// 카드가 읽는 필드 + "바로 풀기" 가능 여부. 카탈로그가 cbtMask 를 이미 들고 있어
// (papers 와 같은 순서의 0/1 문자열) 문제지별 조회를 따로 하지 않는다.
export type ExamComboPaper = LightPaper & { hasCbtAnswers: boolean };

/**
 * 한 시험(시행처+급수)에 속한 문제지 전체. 연도 내림차순 → 과목명(필수과목 먼저) 순 —
 * 웹 getExamAllPapers 와 같은 정렬이다. 연도·회차는 이미 조합이 고정하고 있어 정렬
 * 기준으로 아무 정보도 주지 못하므로 과목명으로 가른다.
 *
 * papers 는 중복 통합이 끝난 목록(decodePapers 결과)이라 건수가 buildExamIndex 의 count·
 * 과목 페이지와 같다. 동점(같은 해·같은 과목)은 카탈로그 순서(연도 → 관례 시행월 → 회차)가
 * 그대로 남는다 — Array#sort 가 안정 정렬이다.
 */
export function collectComboPapers(
  papers: readonly LightPaper[],
  cbtMask: string,
  slug: string,
): ExamComboPaper[] {
  const collected = papers.flatMap<ExamComboPaper>((p, i) => {
    const name = p.exam_types?.name;
    if (!name || comboSlug(name, p.level) !== slug) return [];
    return [{ ...p, hasCbtAnswers: cbtMask[i] === "1" }];
  });
  collected.sort(
    (a, b) =>
      b.year - a.year ||
      compareSubjectNames(a.subjects?.name ?? "", b.subjects?.name ?? ""),
  );
  return collected;
}

/** 연도별로 묶은 목록(내림차순). 웹 ExamAllYearsList 의 byYear 와 같은 묶음. */
export function groupPapersByYear(
  papers: readonly ExamComboPaper[],
): { year: number; papers: ExamComboPaper[] }[] {
  const byYear = new Map<number, ExamComboPaper[]>();
  for (const p of papers) {
    const list = byYear.get(p.year);
    if (list) list.push(p);
    else byYear.set(p.year, [p]);
  }
  return [...byYear.entries()].map(([year, list]) => ({ year, papers: list }));
}
