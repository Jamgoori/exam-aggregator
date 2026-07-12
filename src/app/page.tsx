import { createClient } from "@/lib/supabase/server";
import { HomeExamBrowser } from "@/components/home-exam-browser";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getAllMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getMyBookmarkedSubjectIds } from "@/lib/subject-bookmarks";
import { getHomeStats } from "@/lib/home-stats";
import { getCachedHomeData } from "@/lib/home-data";

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

  // 전역 데이터(문제지 전체·과목·CBT 가능 목록)는 로그인 여부와 무관하게 모두에게
  // 같은 값이라 캐싱해서 받는다(getCachedHomeData). 매 접속마다 1861건을 새로 조인해
  // 받던 무거운 조회(실측 1.5~3초)를 대부분 캐시 히트로 없앤다. 반면 회독수·즐겨찾기는
  // 사용자별 값이라 요청마다 그때그때 조회한다(작고 인덱스로 빨라 캐싱 불필요).
  const [
    { subjects, allPapers, cbtAvailableIds },
    homeStats,
    myRoundCounts,
    bookmarkedIds,
    bookmarkedSubjectIds,
  ] = await Promise.all([
    getCachedHomeData(),
    getHomeStats(),
    userId
      ? getMyRoundCounts(supabase, userId)
      : Promise.resolve(new Map<string, number>()),
    userId
      ? getAllMyBookmarkedPaperIds(supabase, userId)
      : Promise.resolve(new Set<string>()),
    userId
      ? getMyBookmarkedSubjectIds(supabase, userId)
      : Promise.resolve(new Set<string>()),
  ]);
  const { totalCount, totalDownloads, totalAttempts } = homeStats;

  const latestYear = allPapers[0]?.year;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <HomeExamBrowser
        heroText={
          <>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
              {latestYear
                ? `${latestYear}년 자료 업데이트 완료`
                : "기출문제를 업로드해보세요"}
            </span>
            <h1 className="text-3xl font-bold sm:text-4xl dark:text-zinc-100">
              공무원 기출문제,
              <br />
              한 곳에서 빠르게
            </h1>
            <p className="text-zinc-600 dark:text-zinc-400">
              국가직·지방직·서울시 등 주요 공무원 시험 기출문제를 연도별·과목별로
              정리했어요.
            </p>
          </>
        }
        allPapers={allPapers}
        subjects={subjects}
        initialQuery={q ?? ""}
        initialLevel={level}
        initialPage={currentPage}
        bookmarkedIds={[...bookmarkedIds]}
        bookmarkedSubjectIds={[...bookmarkedSubjectIds]}
        cbtAvailableIds={cbtAvailableIds}
        myRoundCounts={Object.fromEntries(myRoundCounts)}
        loggedIn={!!userId}
        totalCount={totalCount}
        totalDownloads={totalDownloads}
        totalAttempts={totalAttempts}
      />
    </div>
  );
}
