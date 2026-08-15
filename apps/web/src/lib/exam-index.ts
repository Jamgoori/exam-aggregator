import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllExamPapers } from "@/lib/all-papers";
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

async function loadPapers() {
  const supabase = createPublicClient();
  const [{ data: subjectRows }, { papers, examTypes }, { data: examTypeRows }] =
    await Promise.all([
      supabase.from("subjects").select("*").order("name"),
      fetchAllExamPapers(supabase),
      supabase.from("exam_types").select("*"),
    ]);
  const subjectById = new Map(
    ((subjectRows ?? []) as Subject[]).map((s) => [s.id, s]),
  );
  const examTypeById = new Map(
    ((examTypeRows ?? []) as ExamType[]).map((t) => [t.id, t]),
  );
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
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const papers = (await collectComboPapers(slug)).filter((p) => p.year === year);
  papers.sort((a, b) =>
    compareSubjectNames(a.subjectName ?? "", b.subjectName ?? ""),
  );
  return papers;
}
