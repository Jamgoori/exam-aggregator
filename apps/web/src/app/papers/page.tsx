// 기출문제 검색 페이지가 항상 즉시(정적 셸) 이동되는지 빌드가 검증하게 한다.
// level·type·q·page는 검색창·묶음 탭·페이지네이션이 쓰는 검색 파라미터라 있음/없음
// 둘 다 선언해둔다.
export const unstable_instant = {
  prefetch: "static",
  samples: [
    { searchParams: { level: null, type: null, q: null, page: null } },
    { searchParams: { level: "9급", type: null, q: "국어", page: "2" } },
  ],
};

import { createClient } from "@/lib/supabase/server";
import { ExamBrowser } from "@/components/exam-browser";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getAllMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getMyBookmarkedSubjectIds } from "@/lib/subject-bookmarks";
import { getHomeStats } from "@/lib/home-stats";
import { getCachedHomeData } from "@/lib/home-data";
import { getMyUnresolvedTotal } from "@/lib/wrong-notes";
import type { Metadata } from "next";

// 기출문제 전체 검색·목록 페이지.
//
// 원래 홈(/)이 이 화면이었다. 홈을 "이 사이트가 뭘 해주는 곳인지"를 말하는 랜딩으로
// 바꾸면서 검색·필터·카드 목록은 통째로 여기로 옮겼다 — 처음 온 사람은 홈에서 사이트를
// 이해하고, 자료를 찾으러 온 사람은 메뉴의 "기출문제"로 곧장 여기 온다. 홈 시절의
// 검색 파라미터 주소(/?q=…)는 next.config 의 redirects 가 여기로 301 로 보낸다.
//
// 검색 파라미터(?q=·?level=·?page=)로 걸러진 목록은 내용이 이 페이지와 사실상 같으므로
// canonical을 "/papers"로 고정해 같은 목록의 변형 URL들이 서로 순위를 나눠 갖지 않게 한다.
export const metadata: Metadata = {
  title: "기출문제 검색 - 국가직·지방직·경찰·소방 공무원 기출 전체 목록",
  description:
    "공무원 기출문제 전체를 과목·급수·시행처·연도로 검색하세요. 국가직·지방직·법원직·경찰·소방 기출문제를 정답과 함께 무료로 열람·다운로드하고 온라인 CBT로 바로 풀 수 있습니다.",
  alternates: { canonical: "/papers" },
  openGraph: { url: "/papers", title: "기출문제 검색" },
};

export default async function PapersPage({
  searchParams,
}: {
  searchParams: Promise<{
    level?: string;
    // 경찰·소방·계리직 묶음(급수가 아닌 시행처 기준)
    type?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { level, type, q, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);
  const supabase = await createClient();

  // 회독 배지 표시용 사용자 식별은 JWT 로컬 검증(getClaims)으로 충분하다 — 실제
  // cbt_attempts 조회는 RLS가 본인 것만 돌려주므로 인증 서버 왕복(getUser)이 필요 없다.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;

  // 전역 데이터(문제지 전체·과목·CBT 가능 목록)는 로그인 여부와 무관하게 모두에게
  // 같은 값이라 캐싱해서 받는다(getCachedHomeData). 반면 회독수·즐겨찾기는 사용자별
  // 값이라 요청마다 그때그때 조회한다(작고 인덱스로 빨라 캐싱 불필요).
  const [
    { subjects, examTypes, papers, cbtMask },
    homeStats,
    myRoundCounts,
    bookmarkedIds,
    bookmarkedSubjectIds,
    wrongNoteCount,
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
    userId ? getMyUnresolvedTotal(supabase, userId) : Promise.resolve(0),
  ]);
  const { totalDownloads, totalAttempts } = homeStats;
  // "총 자료 수"는 exam_papers 원본 행 수(homeStats.totalCount) 대신, 중복 시험지를
  // 합친 뒤 실제로 목록에 보이는 개수를 쓴다 — 아래 "총 N개의 자료"와 숫자가 맞도록.
  const totalCount = papers.length;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <ExamBrowser
        heroText={
          <>
            {/* 홈 시절의 큰 히어로("공모아에서 문제풀고 …")는 랜딩(app/page.tsx)으로
                갔다. 여기는 자료를 찾으러 온 사람의 자리라 제목 한 줄과 범위 한 줄만
                남기고 바로 검색창이 오게 한다. */}
            <h1 className="text-2xl font-bold tracking-tight text-black sm:text-3xl dark:text-zinc-100">
              기출문제 검색
            </h1>
            {/* 모바일은 첫 화면에 카드 목록이 보이도록 통계 타일을 걷어내고
                "총 자료 수"만 이 문장에 통합한 압축 버전, PC(sm 이상)는 아래
                통계 타일 3개(exam-browser.tsx)가 그대로 보이므로 숫자 없는
                원래 문장을 쓴다. */}
            <p className="text-zinc-600 sm:hidden dark:text-zinc-400">
              국가직·지방직·소방·경찰 등 주요 공무원 시험 기출문제{" "}
              {totalCount ? (
                <>
                  <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
                    {totalCount.toLocaleString()}건
                  </strong>
                  을{" "}
                </>
              ) : (
                "를 "
              )}
              연도별·과목별로 정리했어요. 과목명·급수·연도를 섞어 검색할 수 있어요.
            </p>
            <p className="hidden text-zinc-600 sm:block dark:text-zinc-400">
              국가직·지방직·소방·경찰 등 주요 공무원 시험 기출문제를 연도별·과목별로
              정리했어요. &ldquo;2024 국가직 행정법&rdquo;처럼 과목명·급수·연도를 섞어
              검색할 수 있어요.
            </p>
          </>
        }
        papers={papers}
        subjects={subjects}
        examTypes={examTypes}
        initialQuery={q ?? ""}
        initialLevel={level}
        initialExamType={type}
        initialPage={currentPage}
        bookmarkedIds={[...bookmarkedIds]}
        bookmarkedSubjectIds={[...bookmarkedSubjectIds]}
        cbtMask={cbtMask}
        myRoundCounts={Object.fromEntries(myRoundCounts)}
        loggedIn={!!userId}
        wrongNoteCount={wrongNoteCount}
        totalCount={totalCount}
        totalDownloads={totalDownloads}
        totalAttempts={totalAttempts}
      />
    </div>
  );
}
