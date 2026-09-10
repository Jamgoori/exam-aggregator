import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllExamPapers } from "@/lib/all-papers";
import { compareLevels } from "@/lib/level-colors";
import type { ExamType, Subject } from "@gongmoa/core";

// 시행처(국가직·지방직 …) × 급수(9급·7급 …) 한 칸을 가리키는 "시험" 단위.
//
// 왜 둘을 한 슬러그로 묶었나: 경찰·계리직은 level이 비어 있어서 /[시행처]/[급수]
// 처럼 두 칸으로 나누면 빈 칸이 생긴다. "국가직-9급"과 "경찰"을 같은 자리에 두면
// 라우트가 /exams/[exam] 한 칸으로 끝나고, 슬러그 자체가 사람이 읽을 수 있는
// 검색어("국가직-9급")가 된다.
export type ExamCombo = {
  slug: string;
  examTypeName: string;
  level: string | null;
  /** 화면·제목에 쓰는 이름. "국가직 9급" / "경찰" */
  label: string;
  /** 중복 시험지를 합친 뒤의 자료 수 */
  count: number;
  /** 내림차순 연도 목록 */
  years: number[];
  yearCounts: { year: number; count: number }[];
  examTypeOrder: number;
};

export function comboSlug(examTypeName: string, level: string | null): string {
  return level ? `${examTypeName}-${level}` : examTypeName;
}

// 한글이 섞인 슬러그라 링크·canonical·사이트맵 어디서든 반드시 인코딩해서 쓴다.
// 한쪽만 인코딩하면 canonical이 실제 주소와 달라져 색인이 갈린다.
export function examHref(slug: string): string {
  return `/exams/${encodeURIComponent(slug)}`;
}

// 연도는 별도 주소가 아니라 같은 페이지의 필터다. 연도마다 라우트를 두면 시험
// 18개 × 연도 14년 = 250장짜리 페이지 무더기가 생기는데, 대부분 카드 몇 장짜리라
// 과목 페이지에 이미 실린 문제지를 다시 늘어놓는 것 이상의 내용이 없었다.
// 정본은 언제나 연도 없는 주소다 (app/exams/[exam]/page.tsx의 canonical).
export function examYearHref(slug: string, year: number): string {
  return `${examHref(slug)}?year=${year}`;
}

// 문제지 전체 스캔(4,300행 + 중복 판별 조회) 한 벌. 시험 인덱스·시험별 목록(18개)·
// 과목별 목록·getNewestPaperSlugs 가 전부 이 위에서 파생되는데, 각자 캐시 엔트리마다
// fetchAllExamPapers 를 따로 돌리면 배포 직후나 revalidateTag("home-data") 뒤에 같은
// 스캔이 20번 넘게 DB 를 때린다(빌드의 generateStaticParams 도 마찬가지). 여기서 한 번
// 캐시해 파생 엔트리들이 같은 값을 나눠 쓰게 한다. Map 은 캐시에 그대로 못 담으므로
// 배열로 두고 loadPapers 가 매번 Map 을 만든다(수천 건이라 순식간이다).
async function loadPaperTables() {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const [{ data: subjectRows }, { papers, examTypes }, { data: examTypeRows }] =
    await Promise.all([
      supabase.from("subjects").select("*").order("name"),
      fetchAllExamPapers(supabase),
      supabase.from("exam_types").select("*"),
    ]);
  return {
    papers,
    examTypes,
    subjects: (subjectRows ?? []) as Subject[],
    examTypeRows: (examTypeRows ?? []) as ExamType[],
  };
}

async function loadPapers() {
  const { papers, examTypes, subjects, examTypeRows } = await loadPaperTables();
  const subjectById = new Map(subjects.map((s) => [s.id, s]));
  const examTypeById = new Map(examTypeRows.map((t) => [t.id, t]));
  return { papers, examTypes, subjectById, examTypeById };
}

/** 존재하는 시험 조합 전체. 자료가 하나도 없는 조합은 애초에 만들어지지 않는다. */
export async function getExamIndex(): Promise<{
  combos: ExamCombo[];
  totalCount: number;
}> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const { papers, examTypeById } = await loadPapers();

  const acc = new Map<
    string,
    {
      examTypeName: string;
      level: string | null;
      count: number;
      years: Map<number, number>;
      examTypeOrder: number;
    }
  >();

  for (const p of papers) {
    const examType = examTypeById.get(p.exam_type_id);
    if (!examType) continue;
    const slug = comboSlug(examType.name, p.level);
    let entry = acc.get(slug);
    if (!entry) {
      entry = {
        examTypeName: examType.name,
        level: p.level,
        count: 0,
        years: new Map(),
        examTypeOrder: examType.display_order,
      };
      acc.set(slug, entry);
    }
    entry.count += 1;
    entry.years.set(p.year, (entry.years.get(p.year) ?? 0) + 1);
  }

  const combos = [...acc.entries()].map<ExamCombo>(([slug, e]) => {
    const yearCounts = [...e.years.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year);
    return {
      slug,
      examTypeName: e.examTypeName,
      level: e.level,
      label: e.level ? `${e.examTypeName} ${e.level}` : e.examTypeName,
      count: e.count,
      years: yearCounts.map((y) => y.year),
      yearCounts,
      examTypeOrder: e.examTypeOrder,
    };
  });

  // 시행처는 관리자가 정한 순서(display_order)대로, 같은 시행처 안에서는 자료가
  // 많은 급수부터 — 사람들이 가장 많이 찾는 9급이 자연히 앞으로 온다.
  combos.sort(
    (a, b) =>
      a.examTypeOrder - b.examTypeOrder ||
      b.count - a.count ||
      a.slug.localeCompare(b.slug, "ko"),
  );

  return { combos, totalCount: papers.length };
}

export async function getExamCombo(slug: string): Promise<ExamCombo | null> {
  const { combos } = await getExamIndex();
  return combos.find((c) => c.slug === slug) ?? null;
}

/** 카드 렌더링에 필요한 만큼만 붙인 문제지. (ExamCard가 요구하는 필드의 상위집합) */
export type ExamComboPaper = {
  id: string;
  title: string;
  track: string | null;
  level: string | null;
  year: number;
  // 화면에 쓰지는 않지만 문제지 주소(slug)를 만드는 데 필요하다 (paper-href.ts).
  round: number;
  subjectName: string | null;
  exam_types?: ExamType;
};

// 한 시험에 속한 문제지를 모아 카드용 모양으로 붙인다. 정렬은 fetchAllExamPapers가
// 정해둔 순서(연도 → 관례 시행월 → 회차) 그대로라 앞쪽이 가장 최근이다.
async function collectComboPapers(slug: string): Promise<ExamComboPaper[]> {
  const { papers, subjectById, examTypeById } = await loadPapers();
  return papers.flatMap<ExamComboPaper>((p) => {
    const examType = examTypeById.get(p.exam_type_id);
    if (!examType || comboSlug(examType.name, p.level) !== slug) return [];
    return [
      {
        id: p.id,
        title: p.title,
        track: p.track,
        level: p.level,
        year: p.year,
        round: p.round,
        subjectName: subjectById.get(p.subject_id)?.name ?? null,
        exam_types: examType,
      },
    ];
  });
}

// 거의 모든 수험생이 치는 필수과목. 순수 가나다순으로 두면 "건축계획"이 맨 앞에
// 오고 국어·영어·한국사가 목록 한가운데 묻히는데, 이 셋을 찾아온 사람이 압도적으로
// 많다.
const CORE_SUBJECTS = ["국어", "영어", "한국사"];

function compareSubjectNames(a: string, b: string): number {
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

/**
 * 한 시험의 특정 연도 문제지 전체 (/exams/[exam]의 ?year= 필터용).
 *
 * 연도와 회차는 이미 필터가 고정하고 있어서 정렬 기준으로 아무 정보도 주지
 * 못하므로, 과목명으로 정렬한다(필수과목 먼저, 나머지는 가나다순).
 */
export async function getExamYearPapers(
  slug: string,
  year: number,
): Promise<ExamComboPaper[]> {
  return (await getExamAllPapers(slug)).filter((p) => p.year === year);
}

/**
 * 한 시험의 문제지 전체, 연도 내림차순 → 과목명(필수과목 먼저) 순.
 *
 * /exams/[exam] 의 "연도별 전체 목록"이 쓴다. searchParams 를 읽지 않는 순수 캐시
 * 값이라 정적 셸에 그대로 들어간다 — 그래서 시험 허브 18장이 문제지 4천여 장
 * 전부에 실제 <a> 링크를 흘린다. 사이트맵 말고는 문제지로 가는 발견 경로가 없어
 * 크롤러가 "발견됨 - 현재 색인되지 않음"에 문제지를 쌓아 두던 것(2026-09 실측
 * 3,776건)을 여기서 푼다. 연도 필터(getExamYearPapers)도 이 값을 걸러 쓴다 —
 * 캐시 항목이 시험당 하나로 끝난다.
 */
export async function getExamAllPapers(slug: string): Promise<ExamComboPaper[]> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const papers = await collectComboPapers(slug);
  papers.sort(
    (a, b) =>
      b.year - a.year ||
      compareSubjectNames(a.subjectName ?? "", b.subjectName ?? ""),
  );
  return papers;
}

/** 과목 페이지가 쓰는, 한 과목의 문제지 전체 + 탭에 쓸 급수·직렬 목록. */
export type SubjectPapersData = {
  papers: ExamComboPaper[];
  availableLevels: string[];
  availableExamTypes: { id: string; name: string; display_order: number }[];
};

/**
 * 한 과목의 문제지 전체(중복 시험지를 대표 한 장으로 합친 뒤), 최신 시험부터.
 *
 * /subjects/[slug] 가 쓴다. 예전에는 페이지가 요청마다 이 과목의 행을 `select *` 조인으로
 * 전부 받고(국어·영어·한국사는 수백 행) 중복 판별 조회를 이어 돌린 뒤 급수·직렬 탭용
 * 스캔 두 번을 더 했다 — 크롤러를 포함한 모든 방문자가 DB 왕복 세 단계를 기다렸다.
 * 여기서는 홈·시험 페이지와 같은 전체 스캔 캐시(loadPaperTables)를 과목으로 거르기만
 * 하므로 요청 시점에는 조회가 없다. 합치는 기준은 홈 목록과 같다(과목까지 키에 들어
 * 있어 전역으로 합쳐도 과목 안에서 합친 것과 결과가 같다).
 *
 * 정렬은 fetchAllExamPapers 가 정한 순서(연도 → 관례 시행월 → 회차)라 홈 목록과 같다.
 */
export async function getSubjectPapers(subjectId: string): Promise<SubjectPapersData> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const { papers, subjectById, examTypeById } = await loadPapers();
  const subjectName = subjectById.get(subjectId)?.name ?? null;
  const levels = new Set<string>();
  const examTypes = new Map<string, { id: string; name: string; display_order: number }>();
  const out: ExamComboPaper[] = [];
  for (const p of papers) {
    if (p.subject_id !== subjectId) continue;
    const examType = examTypeById.get(p.exam_type_id);
    if (p.level) levels.add(p.level);
    if (examType) examTypes.set(examType.id, examType);
    out.push({
      id: p.id,
      title: p.title,
      track: p.track,
      level: p.level,
      year: p.year,
      round: p.round,
      subjectName,
      exam_types: examType,
    });
  }
  return {
    papers: out,
    availableLevels: [...levels].sort(compareLevels),
    availableExamTypes: [...examTypes.values()].sort(
      (a, b) => a.display_order - b.display_order,
    ),
  };
}
