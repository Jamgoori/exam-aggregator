import Link from "next/link";
import { FileStack, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { SubjectIndexTabs } from "@/components/subject-index-tabs";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import { levelColor } from "@/lib/level-colors";
import { isChoseongQuery, matchesChoseong } from "@/lib/hangul";
import type { ExamPaper, ExamType, Subject } from "@/lib/supabase/types";

const PAGE_SIZE = 24;
const LEVELS = ["9급", "7급"];

// PostgREST의 기본 max-rows(1000) 제한 때문에 한 번에 전체 exam_papers를 못 가져오므로
// 초성 검색 후보를 모을 때는 1000개씩 나눠서 끝까지 가져온다.
async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  let all: T[] = [];
  let offset = 0;
  for (;;) {
    const { data } = await buildQuery(offset, offset + PAGE - 1);
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

function buildHomeHref(params: Record<string, string | undefined>) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    level?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { type, level, q, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);
  const supabase = await createClient();
  const baseParams = { type, level, q };

  // 초성만 입력된 검색어("ㄱㅇ")는 title이 아니라 초성 변환값으로 매칭해야 해서
  // 후보 id를 먼저 뽑아 .in()으로 좁힌다. 일반 텍스트 검색은 기존처럼 ilike 사용.
  const choseongSearch = !!q && isChoseongQuery(q);
  let choseongMatchedIds: string[] | null = null;

  if (choseongSearch) {
    const candidates = await fetchAllRows<{ id: string; subjects: { name: string } }>(
      (from, to) => {
        let candidateQuery = supabase
          .from("exam_papers")
          .select("id, subjects!inner(name), exam_types!inner(name)")
          .range(from, to);
        if (type) candidateQuery = candidateQuery.eq("exam_types.name", type);
        if (level) candidateQuery = candidateQuery.eq("level", level);
        // 임베디드 리소스(subjects)는 실제로는 단일 객체지만 타입 추론상 배열로 잡혀서 캐스팅한다.
        return candidateQuery as unknown as PromiseLike<{
          data: { id: string; subjects: { name: string } }[] | null;
        }>;
      },
    );
    choseongMatchedIds = candidates
      .filter((c) => matchesChoseong(c.subjects.name, q))
      .map((c) => c.id);
  }

  let query = supabase
    .from("exam_papers")
    .select("*, subjects!inner(*), exam_types!inner(*)", { count: "exact" });

  if (type) {
    query = query.eq("exam_types.name", type);
  }
  if (level) {
    query = query.eq("level", level);
  }
  if (choseongSearch) {
    query = query.in("id", choseongMatchedIds ?? []);
  } else if (q) {
    query = query.ilike("subjects.name", `%${q}%`);
  }

  query = query.order("year", { ascending: false }).order("round", { ascending: false });

  const from = (currentPage - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const skipMainQuery = choseongSearch && choseongMatchedIds?.length === 0;

  const [
    { data: examTypes },
    { data: subjects },
    mainResult,
    { count: totalCount },
    { data: downloadRows },
  ] = await Promise.all([
    supabase.from("exam_types").select("*").order("display_order"),
    supabase.from("subjects").select("*").order("name"),
    skipMainQuery ? Promise.resolve({ data: [], count: 0 }) : query,
    supabase.from("exam_papers").select("*", { count: "exact", head: true }),
    supabase.from("exam_papers").select("download_count"),
  ]);
  const { data: papers, count: filteredCount } = mainResult;

  const totalPages = Math.max(1, Math.ceil((filteredCount ?? 0) / PAGE_SIZE));

  const totalDownloads = (downloadRows ?? []).reduce(
    (sum, row) => sum + (row.download_count ?? 0),
    0,
  );
  const latestYear = (papers as ExamPaper[] | null)?.[0]?.year;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-4 py-12">
      <section className="flex flex-col items-start gap-4">
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
          {latestYear
            ? `${latestYear}년 자료 업데이트 완료`
            : "기출문제를 업로드해보세요"}
        </span>
        <h1 className="text-3xl font-bold sm:text-4xl">
          공무원 기출문제,
          <br />
          한 곳에서 빠르게
        </h1>
        <p className="text-zinc-600">
          국가직·지방직·서울시 등 주요 공무원 시험 기출문제를 연도별·과목별로
          정리했어요.
        </p>

        <SearchInput initialQuery={q} />

        <div className="flex flex-wrap gap-3 text-sm">
          <div className="flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2">
            <FileStack size={16} className="text-blue-500" />총 자료 수{" "}
            <strong>{totalCount ?? 0}건</strong>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2">
            <Download size={16} className="text-blue-500" />
            누적 다운로드 <strong>{totalDownloads}회</strong>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildHomeHref({ ...baseParams, type: undefined })}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              !type
                ? "bg-blue-600 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600"
            }`}
          >
            전체
          </Link>
          {((examTypes ?? []) as ExamType[]).map((t) => (
            <Link
              key={t.id}
              href={buildHomeHref({ ...baseParams, type: t.name })}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                type === t.name
                  ? "bg-blue-600 text-white"
                  : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600"
              }`}
            >
              {t.name}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={buildHomeHref({ ...baseParams, level: undefined })}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              !level
                ? "bg-zinc-800 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
            }`}
          >
            전체
          </Link>
          {LEVELS.map((lv) => (
            <Link
              key={lv}
              href={buildHomeHref({ ...baseParams, level: lv })}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                level === lv
                  ? levelColor(lv)
                  : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
              }`}
            >
              {lv}
            </Link>
          ))}
        </div>

        <SubjectIndexTabs subjects={(subjects ?? []) as Subject[]} />

        <p className="text-sm text-zinc-500">
          총 {filteredCount ?? 0}개의 자료
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {((papers as ExamPaper[] | null) ?? []).map((paper) => (
            <ExamCard key={paper.id} paper={paper} linkLevel={level} />
          ))}
          {((papers as ExamPaper[] | null) ?? []).length === 0 && (
            <p className="col-span-full py-12 text-center text-zinc-500">
              조건에 맞는 기출문제가 없습니다.
            </p>
          )}
        </div>

        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          params={baseParams}
        />
      </section>
    </div>
  );
}
