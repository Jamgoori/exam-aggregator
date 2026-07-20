"use client";

import { useMemo, useState, useEffect, useDeferredValue, useRef, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { FileStack, Download, Users, Star } from "lucide-react";
import { ExamCard } from "@/components/exam-card";
import { SearchInput } from "@/components/search-input";
import { SubjectIndexTabs } from "@/components/subject-index-tabs";
import { levelColor } from "@/lib/level-colors";
import {
  filterPapers,
  matchSubjectIds,
  parseSearchQuery,
  getExamTypeNames,
  groupByYearAndSubject,
  type LightPaper,
} from "@/lib/paper-search";
import type { Subject } from "@/lib/supabase/types";
import type { ExamPaper } from "@/lib/supabase/types";

const PAGE_SIZE = 24;
const LEVELS = ["9급", "7급"];
// 브라우저 히스토리 갱신(URL 공유용)은 타이핑 자체를 막지 않도록 아주 살짝만
// 늦춘다 — 실제 필터링은 이 지연과 무관하게 매 입력마다 즉시 일어난다.
const URL_SYNC_DEBOUNCE_MS = 200;
// "즐겨찾기한 과목만 보기" 설정을 다음 방문에도 기억해두기 위한 로컬 저장소 키.
const FAV_ONLY_STORAGE_KEY = "examAggregator:favOnly";

// 페이지 번호 묶음(1~5, 6~10 ...)을 계산하는 로직은 components/pagination.tsx와
// 같은 규칙이지만, 그쪽은 Link 기반 네비게이션이라 여기서는 버튼 기반으로 따로 둔다.
function PageButtons({
  currentPage,
  totalPages,
  blockSize,
  onNavigate,
  className,
}: {
  currentPage: number;
  totalPages: number;
  blockSize: number;
  onNavigate: (page: number) => void;
  className: string;
}) {
  const blockStart = Math.floor((currentPage - 1) / blockSize) * blockSize + 1;
  const blockEnd = Math.min(blockStart + blockSize - 1, totalPages);
  const prevBlockPage = blockStart - 1;
  const nextBlockPage = blockEnd + 1;

  const pages = [];
  for (let p = blockStart; p <= blockEnd; p++) pages.push(p);

  // 한글 검색어를 친 직후엔 마지막 글자의 IME 조합이 아직 열려 있는데, 그 상태로
  // 페이지 버튼을 클릭하면 검색창이 포커스를 잃으면서 조합이 확정되고, 이때
  // 브라우저(Chromium/Edge)가 그 검색창을 화면 안으로 보이게 강제 스크롤해서
  // 화면이 통째로 맨 위로 튀었다. mousedown의 기본 동작(클릭 대상으로 포커스
  // 이동)을 막으면 검색창이 포커스를 유지해 이 확정→강제 스크롤이 아예 일어나지
  // 않는다. 클릭 이벤트 자체는 그대로 발생하므로 페이지 이동은 정상 동작한다.
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <nav className={`items-center justify-center gap-1 pt-4 ${className}`}>
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() => onNavigate(Math.max(1, prevBlockPage))}
        disabled={prevBlockPage < 1}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-blue-300 hover:text-blue-600 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-blue-700 dark:hover:text-blue-400"
      >
        ‹
      </button>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onMouseDown={keepFocus}
          onClick={() => onNavigate(p)}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium ${
            p === currentPage
              ? "bg-blue-600 text-white"
              : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
          }`}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={() => onNavigate(Math.min(totalPages, nextBlockPage))}
        disabled={nextBlockPage > totalPages}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-blue-300 hover:text-blue-600 disabled:pointer-events-none disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-blue-700 dark:hover:text-blue-400"
      >
        ›
      </button>
    </nav>
  );
}

export function HomeExamBrowser({
  heroText,
  allPapers,
  subjects,
  initialQuery,
  initialLevel,
  initialPage,
  bookmarkedIds,
  bookmarkedSubjectIds,
  cbtAvailableIds,
  myRoundCounts,
  loggedIn,
  totalCount,
  totalDownloads,
  totalAttempts,
}: {
  // 배지/제목/소개 문단은 검색어와 무관한 정적 텍스트라 서버에서 그대로 렌더링해
  // 넘겨받는다 — 검색 인터랙션(SearchInput)과 같은 히어로 섹션 안에
  // 나란히 있어야 하는 원래 레이아웃을 유지하기 위한 슬롯이다.
  heroText: ReactNode;
  allPapers: LightPaper[];
  subjects: Subject[];
  initialQuery: string;
  initialLevel?: string;
  initialPage: number;
  bookmarkedIds: string[];
  bookmarkedSubjectIds: string[];
  cbtAvailableIds: string[];
  myRoundCounts: Record<string, number>;
  loggedIn: boolean;
  totalCount: number | null;
  totalDownloads: number | null;
  totalAttempts: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // 검색/급수/페이지 이동은 서버 왕복을 피하려고 라우터 대신 history.replaceState로만
  // URL을 바꾼다(아래 useEffect). 그래서 Next 라우터는 이 변경들을 모르고, 카드 → 문제
  // 상세로 갔다가 뒤로 오면 이 컴포넌트가 Next가 캐시해둔(검색 전) 트리로 다시
  // 마운트되면서 서버가 넘겨준 initialQuery/initialLevel/initialPage(검색 전 값)로
  // 되돌아가 버렸다. 브라우저는 뒤로가기 때 그 히스토리 항목의 URL(?q=…&page=3)을
  // 복원해주므로, 마운트 시 실제 URL을 먼저 읽어 원래 보던 상태로 복귀시킨다.
  // (SSR 최초 로드 땐 URL과 initial* 값이 같은 searchParams에서 나오므로 하이드레이션
  // 불일치가 없다.)
  const [query, setQuery] = useState(() => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("q");
      if (fromUrl) return fromUrl;
    }
    return initialQuery;
  });
  const [level, setLevel] = useState(() => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("level");
      if (fromUrl) return fromUrl;
    }
    return initialLevel;
  });
  // URL(?fav=1)을 우선하고, 없으면 지난번에 저장해둔 로컬 설정을 따른다.
  const [favOnly, setFavOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    const fromUrl = new URLSearchParams(window.location.search).get("fav");
    if (fromUrl === "1") return true;
    if (fromUrl === "0") return false;
    return window.localStorage.getItem(FAV_ONLY_STORAGE_KEY) === "1";
  });
  const [page, setPage] = useState(() => {
    if (typeof window !== "undefined") {
      const fromUrl = Number(
        new URLSearchParams(window.location.search).get("page"),
      );
      if (Number.isInteger(fromUrl) && fromUrl > 0) return fromUrl;
    }
    return initialPage;
  });

  const bookmarkedSet = useMemo(() => new Set(bookmarkedIds), [bookmarkedIds]);
  const bookmarkedSubjectSet = useMemo(
    () => new Set(bookmarkedSubjectIds),
    [bookmarkedSubjectIds],
  );
  const cbtAvailableSet = useMemo(() => new Set(cbtAvailableIds), [cbtAvailableIds]);
  // 로그아웃 상태에서는 로컬에 저장된 favOnly 값이 남아있어도 필터를 걸지 않는다.
  const effectiveFavOnly = favOnly && loggedIn;

  // 카드 목록을 매 키 입력마다 즉시 다시 그리면, 마지막 글자를 치자마자 카드
  // 배치가 바뀌는 순간과 클릭이 겹칠 때 손가락/마우스 아래 있던 카드가 슬쩍
  // 바뀌어 엉뚱한 문제가 눌리는 사고가 났다. 입력창 자체(query)는 즉시 반응하되,
  // 카드 목록을 다시 그리는 데 쓰는 값만 한 박자 늦춰(useDeferredValue) 리액트가
  // 클릭 같은 다급한 이벤트를 이 재배치보다 먼저 처리하게 한다.
  const deferredQuery = useDeferredValue(query);
  // 검색창에 "7급 컴퓨터일반", "2024 국가직 행정법"처럼 급수·연도·시행처가 섞여
  // 있으면 순서·위치와 무관하게 뽑아내 각각 필터로 쓰고, 나머지 텍스트로만
  // 과목명을 매칭한다. 급수 버튼을 따로 누르지 않아도 검색어의 급수가 우선
  // 적용된다(연도·시행처는 버튼 UI가 없어 검색어가 유일한 입력 경로다).
  const examTypeNames = useMemo(() => getExamTypeNames(allPapers), [allPapers]);
  const {
    level: queryLevel,
    year: queryYear,
    examType: queryExamType,
    subjectQuery,
  } = useMemo(
    () => parseSearchQuery(deferredQuery, examTypeNames),
    [deferredQuery, examTypeNames],
  );
  const effectiveLevel = queryLevel ?? level;
  const isSearching = subjectQuery.trim().length > 0;
  const matchedSubjectIds = useMemo(
    () => matchSubjectIds(subjects, subjectQuery),
    [subjects, subjectQuery],
  );
  const filtered = useMemo(
    () =>
      filterPapers(allPapers, {
        level: effectiveLevel,
        year: queryYear,
        examType: queryExamType,
        matchedSubjectIds,
        isSearching,
        favOnly: effectiveFavOnly,
        bookmarkedSubjectIds: bookmarkedSubjectSet,
      }),
    [
      allPapers,
      effectiveLevel,
      queryYear,
      queryExamType,
      matchedSubjectIds,
      isSearching,
      effectiveFavOnly,
      bookmarkedSubjectSet,
    ],
  );

  // 즐겨찾기 모드는 "연도별 → 과목별" 구조로 보여주지만, 여러 과목을 즐겨찾기해
  // 두면 목록이 길어질 수 있어 일반 모드와 같은 페이지 크기로 페이지네이션한다.
  // groupByYearAndSubject가 이미 연도 내림차순·과목명순으로 정렬해주니, 그
  // 결과를 그대로 펼쳐서(flat) 자르면 일반 목록과 같은 순서의 페이지가 된다.
  const favSortedPapers = useMemo(() => {
    if (!effectiveFavOnly) return [];
    const grouped = groupByYearAndSubject(filtered);
    const flat: LightPaper[] = [];
    for (const bySubject of grouped.values()) {
      for (const papers of bySubject.values()) flat.push(...papers);
    }
    return flat;
  }, [effectiveFavOnly, filtered]);

  const totalPages = Math.max(
    1,
    Math.ceil((effectiveFavOnly ? favSortedPapers.length : filtered.length) / PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  const visiblePapers = (effectiveFavOnly ? favSortedPapers : filtered).slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  // 현재 페이지에 보이는 문제지만 다시 연도/과목으로 묶어서, 페이지를 넘겨도
  // 그 페이지 안에서는 여전히 연도별 소제목이 붙어 보인다.
  const groupedByYear = useMemo(
    () => (effectiveFavOnly ? groupByYearAndSubject(visiblePapers) : null),
    [effectiveFavOnly, visiblePapers],
  );

  // 검색어/급수를 바꾸면 이전 페이지 번호가 새 결과 범위를 벗어날 수 있어 1로 되돌린다.
  function handleQueryChange(next: string) {
    setQuery(next);
    setPage(1);
  }
  function handleLevelChange(next: string | undefined) {
    setLevel(next);
    setPage(1);
  }
  function handleToggleFavOnly() {
    if (!loggedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }
    const next = !favOnly;
    setFavOnly(next);
    setPage(1);
    window.localStorage.setItem(FAV_ONLY_STORAGE_KEY, next ? "1" : "0");
  }

  // 뒤쪽 페이지(카드 수가 적어 문서 높이가 짧음)를 보다가 앞쪽 페이지처럼 카드가
  // 많은 페이지로 갈 때, 스크롤을 많이 내려둔 상태였다면 문서 높이가 줄어드는
  // 순간 브라우저가 스크롤 위치를 새 최대치로 강제로 당겨 올린다 — 그 바람에
  // 화면이 위로 튀면서 마우스 아래 있던 카드가 바뀌어 엉뚱한 곳이 눌리는 사고가
  // 났다. 예전엔 이걸 막으려고 페이지 번호를 누를 때마다 결과 영역 맨 위로
  // 강제로 스크롤시켰는데, 그러면 클릭할 때마다(문서 높이가 줄지 않는 경우까지)
  // 화면이 확 튀어서 바로 이어지는 클릭이 옮겨간 카드 위에서 발생하는 같은 문제를
  // 더 자주 일으켰다. 대신 클릭 시점엔 결과 영역에 이전 높이만큼 min-height를
  // 잠깐 걸어 문서가 줄어드는 걸 막아 클릭 처리 중엔 스크롤이 전혀 변하지 않게
  // 하고, 클릭이 끝난 뒤(다음 렌더 시점)에만 min-height를 풀어준다.
  const resultsSectionRef = useRef<HTMLElement>(null);
  function handlePageChange(next: number) {
    const el = resultsSectionRef.current;
    if (el) el.style.minHeight = `${el.offsetHeight}px`;
    setPage(next);
  }
  useEffect(() => {
    const el = resultsSectionRef.current;
    if (el) el.style.minHeight = "";
  }, [safePage]);

  // 주소창 URL은 공유/새로고침용으로만 갱신한다 — 여기서 서버를 다시 부르지
  // 않도록 Next 라우터 대신 history API를 직접 쓴다.
  useEffect(() => {
    const timeout = setTimeout(() => {
      const usp = new URLSearchParams();
      if (query) usp.set("q", query);
      if (level) usp.set("level", level);
      if (effectiveFavOnly) usp.set("fav", "1");
      if (safePage > 1) usp.set("page", String(safePage));
      const qs = usp.toString();
      window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
    }, URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query, level, effectiveFavOnly, safePage]);

  return (
    <>
      <section className="flex flex-col items-start gap-4">
        {heroText}

        <SearchInput value={query} onChange={handleQueryChange} />

        {/* 통계 타일은 PC(sm 이상)에만 보여준다. 모바일에서는 첫 화면에 카드
            목록이 들어오도록 걷어냈고, "총 자료 수"만 소개 문장에 통합돼 있다
            (page.tsx의 모바일 전용 소개 문단). PC는 검색창(596px)과 같은 폭으로
            위 소개 문단 줄 끝과 나란히 보이게 한다. */}
        <div className="mt-4 hidden w-full max-w-[596px] grid-cols-3 gap-3 text-center sm:grid">
          <div className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border-2 border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <FileStack size={20} className="text-blue-500" />
            <span className="whitespace-nowrap text-sm font-medium text-zinc-600 dark:text-zinc-400">
              총 자료 수
            </span>
            <strong className="text-lg tabular-nums">{totalCount ?? 0}건</strong>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border-2 border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <Download size={20} className="text-blue-500" />
            <span className="whitespace-nowrap text-sm font-medium text-zinc-600 dark:text-zinc-400">
              누적 다운로드
            </span>
            <strong className="text-lg tabular-nums">{totalDownloads ?? 0}회</strong>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border-2 border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <Users size={20} className="text-blue-500" />
            <span className="whitespace-nowrap text-sm font-medium text-zinc-600 dark:text-zinc-400">
              실시간 총 응시 수
            </span>
            <strong className="text-lg tabular-nums">{totalAttempts ?? 0}건</strong>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleFavOnly}
          aria-pressed={effectiveFavOnly}
          title={loggedIn ? undefined : "로그인 후 이용할 수 있어요"}
          className={`mt-2 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium ${
            effectiveFavOnly
              ? "border border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
              : "border border-zinc-200 text-zinc-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-amber-800 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
          }`}
        >
          <Star size={14} fill={effectiveFavOnly ? "currentColor" : "none"} />
          즐겨찾기한 과목만 보기
        </button>
      </section>

      <section ref={resultsSectionRef} className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleLevelChange(undefined)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              !effectiveLevel
                ? "bg-zinc-800 text-white dark:bg-zinc-700"
                : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            전체
          </button>
          {LEVELS.map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => handleLevelChange(lv)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                effectiveLevel === lv
                  ? levelColor(lv)
                  : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
              }`}
            >
              {lv}
            </button>
          ))}
        </div>

        <SubjectIndexTabs
          subjects={subjects}
          bookmarkedSubjectIds={bookmarkedSubjectSet}
          loggedIn={loggedIn}
        />

        <p className="text-sm text-zinc-500 dark:text-zinc-500">총 {filtered.length}개의 자료</p>

        {groupedByYear ? (
          <div className="flex flex-col gap-8">
            {filtered.length === 0 && (
              <p className="py-12 text-center text-zinc-500 dark:text-zinc-500">
                {bookmarkedSubjectSet.size === 0
                  ? "아직 즐겨찾기한 과목이 없어요. 과목 옆의 별 아이콘을 눌러 추가해보세요."
                  : "조건에 맞는 기출문제가 없습니다."}
              </p>
            )}
            {[...groupedByYear.entries()].map(([year, bySubject]) => (
              <div key={year} className="flex flex-col gap-4">
                <h2 className="text-lg font-bold">{year}년</h2>
                {[...bySubject.entries()].map(([subjectName, papers]) => (
                  <div key={subjectName} className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-zinc-500 dark:text-zinc-500">
                      {subjectName}
                    </h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {papers.map((paper) => (
                        <ExamCard
                          key={paper.id}
                          paper={paper as unknown as ExamPaper}
                          linkLevel={effectiveLevel}
                          myRoundCount={myRoundCounts[paper.id]}
                          isBookmarked={bookmarkedSet.has(paper.id)}
                          loggedIn={loggedIn}
                          hasCbtAnswers={cbtAvailableSet.has(paper.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visiblePapers.map((paper) => (
              <ExamCard
                key={paper.id}
                paper={paper as unknown as ExamPaper}
                linkLevel={effectiveLevel}
                myRoundCount={myRoundCounts[paper.id]}
                isBookmarked={bookmarkedSet.has(paper.id)}
                loggedIn={loggedIn}
                hasCbtAnswers={cbtAvailableSet.has(paper.id)}
              />
            ))}
            {visiblePapers.length === 0 && (
              <p className="col-span-full py-12 text-center text-zinc-500 dark:text-zinc-500">
                조건에 맞는 기출문제가 없습니다.
              </p>
            )}
          </div>
        )}

        {totalPages > 1 && (
          <>
            <PageButtons
              currentPage={safePage}
              totalPages={totalPages}
              blockSize={5}
              onNavigate={handlePageChange}
              className="flex sm:hidden"
            />
            <PageButtons
              currentPage={safePage}
              totalPages={totalPages}
              blockSize={10}
              onNavigate={handlePageChange}
              className="hidden sm:flex"
            />
          </>
        )}
      </section>
    </>
  );
}
