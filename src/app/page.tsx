import { FileStack, Download, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { HomeExamBrowser } from "@/components/home-exam-browser";
import { SubjectIndexTabs } from "@/components/subject-index-tabs";
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

        {/* pill을 flex-wrap으로 늘어놓으면 좁은 화면에서 한 줄에 안 들어가 3줄로
            쌓여 지저분해져서, 폭과 무관하게 항상 3칸을 유지하는 스탯 타일로 바꿨다.
            PC(sm 이상)에서는 search-input과 같은 596px로 맞춰 위 소개 문단 줄 끝과
            나란히 보이게 한다. mt-4는 section의 gap-4에 더해져서, 그리드 위 여백이
            아래(섹션 간 gap-8)와 같아지도록 맞춘 값이다. */}
        <div className="mt-4 grid w-full max-w-xs grid-cols-3 gap-1.5 text-center sm:max-w-[596px] sm:gap-3">
          <div className="flex min-w-0 flex-col items-center gap-0.5 rounded-xl border border-zinc-200 px-1.5 py-2 sm:gap-1 sm:rounded-2xl sm:border-2 sm:px-4 sm:py-3">
            <FileStack size={14} className="text-blue-500 sm:size-5" />
            <span className="whitespace-nowrap text-[11px] font-medium text-zinc-600 sm:text-sm">
              총 자료 수
            </span>
            <strong className="text-sm tabular-nums sm:text-lg">{totalCount ?? 0}건</strong>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-0.5 rounded-xl border border-zinc-200 px-1.5 py-2 sm:gap-1 sm:rounded-2xl sm:border-2 sm:px-4 sm:py-3">
            <Download size={14} className="text-blue-500 sm:size-5" />
            <span className="whitespace-nowrap text-[11px] font-medium text-zinc-600 sm:text-sm">
              누적 다운로드
            </span>
            <strong className="text-sm tabular-nums sm:text-lg">{totalDownloads ?? 0}회</strong>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-0.5 rounded-xl border border-zinc-200 px-1.5 py-2 sm:gap-1 sm:rounded-2xl sm:border-2 sm:px-4 sm:py-3">
            <Users size={14} className="text-blue-500 sm:size-5" />
            {/* PC에서는 검색창만큼 폭이 넉넉해져 전체 문구가 한 줄로 들어가지만,
                모바일 좁은 칸에서는 그대로 두면 줄바꿈되니 짧은 문구를 따로 쓴다. */}
            <span className="whitespace-nowrap text-[11px] font-medium text-zinc-600 sm:hidden">
              실시간 응시 수
            </span>
            <span className="hidden whitespace-nowrap text-sm font-medium text-zinc-600 sm:inline">
              실시간 총 응시 수
            </span>
            <strong className="text-sm tabular-nums sm:text-lg">{totalAttempts ?? 0}건</strong>
          </div>
        </div>
      </section>

      <SubjectIndexTabs subjects={(subjects ?? []) as Subject[]} />

      <HomeExamBrowser
        allPapers={allPapers}
        subjects={(subjects ?? []) as Subject[]}
        initialQuery={q ?? ""}
        initialLevel={level}
        initialPage={currentPage}
        bookmarkedIds={[...bookmarkedIds]}
        cbtAvailableIds={[...cbtAvailability]}
        myRoundCounts={Object.fromEntries(myRoundCounts)}
        loggedIn={!!userId}
      />
    </div>
  );
}
