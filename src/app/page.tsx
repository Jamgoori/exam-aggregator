import { createClient } from "@/lib/supabase/server";
import { HomeExamBrowser } from "@/components/home-exam-browser";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getAllMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getAllCbtAvailability } from "@/lib/cbt-availability";
import { getHomeStats } from "@/lib/home-stats";
import type { LightPaper } from "@/lib/paper-search";
import type { Subject } from "@/lib/supabase/types";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    level?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { level, q, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);
  const supabase = await createClient();

  // 회독 배지 표시용 사용자 식별은 JWT 로컬 검증(getClaims)으로 충분하다 — 실제
  // cbt_attempts 조회는 RLS가 본인 것만 돌려주므로 인증 서버 왕복(getUser)이 필요 없다.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;

  // 검색을 서버 왕복 없이 즉시(클라이언트) 필터링으로 바꾸면서, 문제지 전체를
  // 가벼운 필드만 골라 한 번에 받아둔다(제목/과목 정도만 있으면 카드 렌더링과
  // 필터링에 충분하다 — 1900여 건이라 gzip 후 수백KB 이내라 부담 없다).
  const [
    { data: subjects },
    { data: allPapersRaw },
    homeStats,
    myRoundCounts,
    bookmarkedIds,
    cbtAvailability,
  ] = await Promise.all([
    supabase.from("subjects").select("*").order("name"),
    supabase
      .from("exam_papers")
      .select("id, title, level, year, round, subject_id, subjects(id, name, slug)")
      .order("year", { ascending: false })
      .order("round", { ascending: false }),
    getHomeStats(),
    userId
      ? getMyRoundCounts(supabase, userId)
      : Promise.resolve(new Map<string, number>()),
    userId
      ? getAllMyBookmarkedPaperIds(supabase, userId)
      : Promise.resolve(new Set<string>()),
    getAllCbtAvailability(supabase),
  ]);
  const { totalCount, totalDownloads, totalAttempts } = homeStats;

  const allPapers = (allPapersRaw ?? []) as unknown as LightPaper[];
  const latestYear = allPapers[0]?.year;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pt-6 pb-12 sm:pt-8">
      <HomeExamBrowser
        heroText={
          <>
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
          </>
        }
        allPapers={allPapers}
        subjects={(subjects ?? []) as Subject[]}
        initialQuery={q ?? ""}
        initialLevel={level}
        initialPage={currentPage}
        bookmarkedIds={[...bookmarkedIds]}
        cbtAvailableIds={[...cbtAvailability]}
        myRoundCounts={Object.fromEntries(myRoundCounts)}
        loggedIn={!!userId}
        totalCount={totalCount}
        totalDownloads={totalDownloads}
        totalAttempts={totalAttempts}
      />
    </div>
  );
}
