import Link from "next/link";
import { Search, FileStack, TrendingUp, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { SortSelect } from "@/components/sort-select";
import type { ExamPaper, ExamType } from "@/lib/supabase/types";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; sort?: string; q?: string }>;
}) {
  const { type, sort = "latest", q } = await searchParams;
  const supabase = await createClient();

  const { data: examTypes } = await supabase
    .from("exam_types")
    .select("*")
    .order("name");

  let query = supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types!inner(*)");

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

  const { data: papers } = await query;

  const [{ count: totalCount }, { count: monthCount }, { data: downloadRows }] =
    await Promise.all([
      supabase.from("exam_papers").select("*", { count: "exact", head: true }),
      supabase
        .from("exam_papers")
        .select("*", { count: "exact", head: true })
        .gte(
          "created_at",
          new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
        ),
      supabase.from("exam_papers").select("download_count"),
    ]);

  const totalDownloads = (downloadRows ?? []).reduce(
    (sum, row) => sum + (row.download_count ?? 0),
    0,
  );
  const latestYear = (papers as ExamPaper[] | null)?.[0]?.year;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-10 px-4 py-12">
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

        <form action="/" method="GET" className="w-full max-w-md">
          <div className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2">
            <Search size={16} className="text-zinc-400" />
            <input
              name="q"
              defaultValue={q}
              placeholder="과목명, 시험 종류, 연도로 검색..."
              className="w-full text-sm outline-none"
            />
          </div>
        </form>

        <div className="flex flex-wrap gap-3 text-sm">
          <div className="flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2">
            <FileStack size={16} className="text-zinc-400" />총 자료 수{" "}
            <strong>{totalCount ?? 0}건</strong>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2">
            <TrendingUp size={16} className="text-zinc-400" />
            이번 달 업로드 <strong>{monthCount ?? 0}건</strong>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-zinc-200 px-4 py-2">
            <Download size={16} className="text-zinc-400" />
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
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
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
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
                }`}
              >
                {t.name}
              </Link>
            ))}
          </div>
          <SortSelect />
        </div>

        <p className="text-sm text-zinc-500">
          총 {(papers as ExamPaper[] | null)?.length ?? 0}개의 자료
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {((papers as ExamPaper[] | null) ?? []).map((paper) => (
            <ExamCard key={paper.id} paper={paper} />
          ))}
          {((papers as ExamPaper[] | null) ?? []).length === 0 && (
            <p className="col-span-full py-12 text-center text-zinc-500">
              조건에 맞는 기출문제가 없습니다.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
