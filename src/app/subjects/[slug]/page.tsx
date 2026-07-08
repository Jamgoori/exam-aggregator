import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { Pagination } from "@/components/pagination";
import { levelColor, compareLevels } from "@/lib/level-colors";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getCbtAvailability } from "@/lib/cbt-availability";
import type { ExamPaper, Subject } from "@/lib/supabase/types";
import type { Metadata } from "next";

const PAGE_SIZE = 24;

// generateMetadata와 페이지 본문이 같은 slug로 중복 조회하지 않도록 캐싱
const getSubject = cache(async (slug: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("subjects")
    .select("*")
    .eq("slug", slug)
    .single();
  return data as Subject | null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const subject = await getSubject(slug);
  if (!subject) return {};

  return {
    title: `${subject.name} 기출문제 모음`,
    description: `${subject.name} 과목의 공무원 기출문제를 연도별·급수별로 모아봤어요.`,
  };
}

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ level?: string; page?: string }>;
}) {
  const { slug } = await params;
  const { level, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);
  const supabase = await createClient();

  const subject = await getSubject(slug);

  if (!subject) {
    notFound();
  }

  // 회독 배지용 사용자 식별은 JWT 로컬 검증(getClaims)으로 충분하다 — cbt_attempts
  // 조회 자체가 RLS로 본인 것만 반환되므로 인증 서버 왕복(getUser)이 필요 없다.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;

  // 급수 탭은 이 과목에 존재하는 급수 종류만 필요하므로, 목록 전체를 받아오는 대신
  // level 컬럼만 가볍게 조회해서 만든다.
  let papersQuery = supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types(*)", { count: "exact" })
    .eq("subject_id", subject.id);
  if (level) papersQuery = papersQuery.eq("level", level);
  const from = (currentPage - 1) * PAGE_SIZE;

  const [{ data: levelRows }, { data: papers, count: filteredCount }, myRoundCounts] =
    await Promise.all([
      supabase.from("exam_papers").select("level").eq("subject_id", subject.id),
      papersQuery
        .order("year", { ascending: false })
        .order("round", { ascending: false })
        .range(from, from + PAGE_SIZE - 1),
      userId
        ? getMyRoundCounts(supabase, userId)
        : Promise.resolve(new Map<string, number>()),
    ]);

  const availableLevels = [
    ...new Set(
      (levelRows ?? []).map((r) => r.level).filter((l): l is string => !!l),
    ),
  ].sort(compareLevels);
  const filteredPapers = (papers ?? []) as ExamPaper[];

  // 카드 목록이 정해진 뒤에야 그 문제지들의 id를 알 수 있어서, 메인 조회와
  // 병렬로 묶지 않고 그 다음 단계에서 한 번 더 병렬 조회한다.
  const filteredPaperIds = filteredPapers.map((p) => p.id);
  const [bookmarkedIds, cbtAvailability] = await Promise.all([
    userId
      ? getMyBookmarkedPaperIds(supabase, userId, filteredPaperIds)
      : Promise.resolve(new Set<string>()),
    getCbtAvailability(supabase, filteredPaperIds),
  ]);
  const totalPages = Math.max(1, Math.ceil((filteredCount ?? 0) / PAGE_SIZE));

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/" className="text-sm text-zinc-500 underline">
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">
          {subject.name}
        </h1>
      </div>

      {availableLevels.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/subjects/${slug}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              !level
                ? "bg-zinc-800 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
            }`}
          >
            전체
          </Link>
          {availableLevels.map((lv) => (
            <Link
              key={lv}
              href={`/subjects/${slug}?level=${encodeURIComponent(lv)}`}
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
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredPapers.length === 0 && (
          <p className="col-span-full py-12 text-center text-zinc-500">
            {(levelRows ?? []).length === 0
              ? "아직 업로드된 기출문제가 없습니다."
              : "해당 급수의 기출문제가 없습니다."}
          </p>
        )}
        {filteredPapers.map((paper) => (
          <ExamCard
            key={paper.id}
            paper={paper}
            linkLevel={level}
            myRoundCount={myRoundCounts.get(paper.id)}
            isBookmarked={bookmarkedIds.has(paper.id)}
            loggedIn={!!userId}
            hasCbtAnswers={cbtAvailability.has(paper.id)}
          />
        ))}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        params={{ level }}
        basePath={`/subjects/${slug}`}
      />
    </div>
  );
}
