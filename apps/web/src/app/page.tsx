// 홈 진입이 항상 즉시(정적 셸) 이동되는지 빌드가 검증하게 한다. level·type·q·page는
// 검색창·묶음 탭·페이지네이션이 쓰는 검색 파라미터라 있음/없음 둘 다 선언해둔다.
export const unstable_instant = {
  prefetch: "static",
  samples: [
    { searchParams: { level: null, type: null, q: null, page: null } },
    { searchParams: { level: "9급", type: null, q: "국어", page: "2" } },
  ],
};

import { createClient } from "@/lib/supabase/server";
import { HomeExamBrowser } from "@/components/home-exam-browser";
import { HomePopupSlider } from "@/components/home-popup-slider";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getAllMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getMyBookmarkedSubjectIds } from "@/lib/subject-bookmarks";
import { getHomeStats } from "@/lib/home-stats";
import { getCachedHomeData } from "@/lib/home-data";
import { getMyUnresolvedTotal } from "@/lib/wrong-notes";
import type { Metadata } from "next";

// 검색 파라미터(?q=·?level=·?page=)로 걸러진 홈은 내용이 홈과 사실상 같으므로
// canonical을 "/"로 고정해 같은 목록의 변형 URL들이 서로 순위를 나눠 갖지 않게 한다.
export const metadata: Metadata = {
  // 루트 레이아웃의 template("%s | 공모아")이 붙지 않도록 absolute로 준다.
  title: { absolute: "공모아 - 공무원 기출문제 무료 자료실 (국가직·지방직 기출)" },
  alternates: {
    canonical: "/",
    // 새 문제지 피드(app/rss.xml). 네이버 웹마스터도구에 직접 제출하지만,
    // <link rel="alternate">가 있어야 피드 리더와 다른 수집기도 찾아낸다.
    types: { "application/rss+xml": [{ url: "/rss.xml", title: "공모아 새 기출문제" }] },
  },
  openGraph: { url: "/" },
};

export default async function Home({
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

  // papers는 전송량을 줄인 튜플 표현이라 연도는 인덱스로 읽는다(paper-search의
  // PaperWire 주석 참고). 목록은 최신순이므로 첫 항목이 최신 연도다.
  const latestYear = papers[0]?.[4];

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      {/* 홈에 뜰 수 있는 안내(개발 중 안내·복습 유도·출석 이벤트 광고)를 한 판에 담아
          좌우로 넘겨 보는 슬라이드. 판을 띄울지, 어떤 장이 실릴지는 전부 마운트된 뒤에
          정한다 — 복습 요약처럼 무거운 조회를 홈 서버 렌더에 끼워 넣으면 팝업을 볼 일
          없는 사람까지 매번 그 값을 치른다. 로그인 여부로 미리 걸러내지도 않는다:
          개발 중 안내와 출석 광고는 비회원에게 더 필요하고(가입할 이유 자체다), 복습
          유도는 서버 액션이 비회원에게 빈 결과를 돌려주므로 저절로 빠진다.
          출석 광고가 가는 곳만 갈린다 — 회원은 출석 현황, 비회원은 가입(로그인 화면으로
          보내면 계정이 없는 사람이 막다른 길을 만난다).
          장을 싣고 넘기고 기록하는 규칙은 lib/home-popup.ts 참고. */}
      <HomePopupSlider attendanceHref={userId ? "/mypage?tab=attendance" : "/signup"} />
      <HomeExamBrowser
        heroText={
          <>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
              {latestYear
                ? `${latestYear}년 자료 업데이트 완료`
                : "기출문제를 업로드해보세요"}
            </span>
            <h1 className="text-3xl font-bold text-black sm:text-4xl dark:text-zinc-100">
              나만의{" "}
              <span className="text-blue-600 dark:text-blue-400">데이터</span>
              로,
              <br />
              합격까지 빠르게
            </h1>
            {/* 모바일은 첫 화면에 카드 목록이 보이도록 통계 타일을 걷어내고
                "총 자료 수"만 이 문장에 통합한 압축 버전, PC(sm 이상)는 아래
                통계 타일 3개(home-exam-browser.tsx)가 그대로 보이므로 숫자 없는
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
              연도별·과목별로 정리했어요.
            </p>
            <p className="hidden text-zinc-600 sm:block dark:text-zinc-400">
              국가직·지방직·소방·경찰 등 주요 공무원 시험 기출문제를 연도별·과목별로
              정리했어요.
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
