import Link from "next/link";
import { FileStack, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { SortSelect } from "@/components/sort-select";
import { SubjectIndexTabs } from "@/components/subject-index-tabs";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import type { ExamPaper, ExamType, Subject } from "@/lib/supabase/types";

const PAGE_SIZE = 24;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string;
    sort?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { type, sort = "latest", q, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types!inner(*)", { count: "exact" });

  if (type) {
    query = query.eq("exam_types.name", type);
  }
  if (q) {
    query = query.ilike("title", `%${q}%`);
  }

  if (sort === "downloads") {
    query = query.order("download_count", { ascending: false });
  } else {
    query = query
      .order("year", { ascending: false })
      .order("round", { ascending: false });
  }

  const from = (currentPage - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const [
    { data: examTypes },
    { data: subjects },
    { data: papers, count: filteredCount },
    { count: totalCount },
    { data: downloadRows },
  ] = await Promise.all([
    supabase.from("exam_types").select("*").order("display_order"),
    supabase.from("subjects").select("*").order("name"),
    query,
    supabase.from("exam_papers").select("*", { count: "exact", head: true }),
    supabase.from("exam_papers").select("download_count"),
  ]);

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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <Link
              href="/"
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
                href={`/?type=${encodeURIComponent(t.name)}`}
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
          <SortSelect />
        </div>

        <SubjectIndexTabs subjects={(subjects ?? []) as Subject[]} />

        <p className="text-sm text-zinc-500">
          총 {filteredCount ?? 0}개의 자료
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {((papers as ExamPaper[] | null) ?? []).map((paper) => (
            <ExamCard key={paper.id} paper={paper} />
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
          params={{ type, sort: sort === "latest" ? undefined : sort, q }}
        />
      </section>
    </div>
  );
}
