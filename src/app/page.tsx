import Link from "next/link";
import { FileStack, Download, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { Pagination } from "@/components/pagination";
import { SearchInput } from "@/components/search-input";
import { SubjectIndexTabs } from "@/components/subject-index-tabs";
import { levelColor } from "@/lib/level-colors";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getCbtAvailability } from "@/lib/cbt-availability";
import { getHomeStats } from "@/lib/home-stats";
import { isChoseongQuery, matchesChoseong } from "@/lib/hangul";
import type { ExamPaper, Subject } from "@/lib/supabase/types";

const PAGE_SIZE = 24;
const LEVELS = ["9급", "7급"];

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
    level?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { level, q, page } = await searchParams;
  const currentPage = Math.max(1, Number(page) || 1);
  const supabase = await createClient();
  const baseParams = { level, q };

  // 회독 배지 표시용 사용자 식별은 JWT 로컬 검증(getClaims)으로 충분하다 — 실제
  // cbt_attempts 조회는 RLS가 본인 것만 돌려주므로 인증 서버 왕복(getUser)이 필요 없다.
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;

  // subjects(7개뿐)는 검색어 매칭에, 나머지 둘은 검색어와 무관한 값이라 여기서
  // 한 번에 병렬로 받아둔다. 예전에는 subjects만 먼저 기다렸다가 그 다음에야
  // 나머지를 조회해서, 검색창에 한 글자 칠 때마다 왕복이 하나 더 끼어들었다.
  const [{ data: subjects }, homeStats, myRoundCounts] = await Promise.all([
    supabase.from("subjects").select("*").order("name"),
    getHomeStats(),
    userId
      ? getMyRoundCounts(supabase, userId)
      : Promise.resolve(new Map<string, number>()),
  ]);
  const { totalCount, totalDownloads, totalAttempts } = homeStats;

  const trimmedQuery = q?.trim() ?? "";
  const isSearching = trimmedQuery.length > 0;
  const choseongSearch = isSearching && isChoseongQuery(trimmedQuery);

  let matchedSubjectIds: string[] = [];
  if (choseongSearch) {
    matchedSubjectIds = (subjects ?? [])
      .filter((s) => matchesChoseong(s.name, trimmedQuery))
      .map((s) => s.id);
  } else if (isSearching) {
    const lowerQuery = trimmedQuery.toLowerCase();
    const subjectList = subjects ?? [];
    // 단어 중간에 우연히 검색어가 들어가는 과목까지 그냥 다 보여주면("국어" 검색
    // 시 "중국어"까지 나오는 식) 헷갈리니, 이름이 검색어로 시작하는 과목이 하나라도
    // 있으면 그것만 보여준다. 그런 과목이 하나도 없을 때만("법"으로 형법·민법을
    // 찾는 경우처럼 검색어가 단어 뒷부분에 있는 경우) 단어 중간 포함까지 넓힌다.
    const prefixMatches = subjectList.filter((s) =>
      s.name.toLowerCase().startsWith(lowerQuery),
    );
    matchedSubjectIds = (
      prefixMatches.length > 0
        ? prefixMatches
        : subjectList.filter((s) => s.name.toLowerCase().includes(lowerQuery))
    ).map((s) => s.id);
  }

  let query = supabase
    .from("exam_papers")
    .select("*, subjects!inner(*), exam_types!inner(*)", { count: "exact" });

  if (level) {
    query = query.eq("level", level);
  }
  if (isSearching) {
    query = query.in("subject_id", matchedSubjectIds);
  }

  query = query.order("year", { ascending: false }).order("round", { ascending: false });

  const from = (currentPage - 1) * PAGE_SIZE;
  query = query.range(from, from + PAGE_SIZE - 1);

  const skipMainQuery = isSearching && matchedSubjectIds.length === 0;

  const mainResult = skipMainQuery
    ? { data: [] as ExamPaper[], count: 0 }
    : await query;
  const { data: papers, count: filteredCount } = mainResult;

  // 카드 목록이 정해진 뒤에야 그 문제지들의 id를 알 수 있어서(북마크/CBT 가능
  // 여부는 화면에 보이는 문제지 범위로만 배치 조회한다), 메인 조회와 병렬로
  // 묶지 않고 그 다음 단계에서 한 번 더 병렬 조회한다.
  const paperIds = ((papers as ExamPaper[] | null) ?? []).map((p) => p.id);
  const [bookmarkedIds, cbtAvailability] = await Promise.all([
    userId
      ? getMyBookmarkedPaperIds(supabase, userId, paperIds)
      : Promise.resolve(new Set<string>()),
    getCbtAvailability(supabase, paperIds),
  ]);

  const totalPages = Math.max(1, Math.ceil((filteredCount ?? 0) / PAGE_SIZE));
  const latestYear = (papers as ExamPaper[] | null)?.[0]?.year;

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

        <SearchInput initialQuery={q} />

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

      <section className="flex flex-col gap-4">
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
