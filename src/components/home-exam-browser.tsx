"use client";

import { useMemo, useState, useEffect, type ReactNode } from "react";
import { FileStack, Download, Users } from "lucide-react";
import { ExamCard } from "@/components/exam-card";
import { SearchInput } from "@/components/search-input";
import { SubjectIndexTabs } from "@/components/subject-index-tabs";
import { levelColor } from "@/lib/level-colors";
import { filterPapers, matchSubjectIds, type LightPaper } from "@/lib/paper-search";
import type { Subject } from "@/lib/supabase/types";
import type { ExamPaper } from "@/lib/supabase/types";

const PAGE_SIZE = 24;
const LEVELS = ["9급", "7급"];
// 브라우저 히스토리 갱신(URL 공유용)은 타이핑 자체를 막지 않도록 아주 살짝만
// 늦춘다 — 실제 필터링은 이 지연과 무관하게 매 입력마다 즉시 일어난다.
const URL_SYNC_DEBOUNCE_MS = 200;

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

  return (
    <nav className={`items-center justify-center gap-1 pt-4 ${className}`}>
      <button
        type="button"
        onClick={() => onNavigate(Math.max(1, prevBlockPage))}
        disabled={prevBlockPage < 1}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-blue-300 hover:text-blue-600 disabled:pointer-events-none disabled:opacity-40"
      >
        ‹
      </button>
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onNavigate(p)}
          className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm font-medium ${
            p === currentPage
              ? "bg-blue-600 text-white"
              : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600"
          }`}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onNavigate(Math.min(totalPages, nextBlockPage))}
        disabled={nextBlockPage > totalPages}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:border-blue-300 hover:text-blue-600 disabled:pointer-events-none disabled:opacity-40"
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
  cbtAvailableIds,
  myRoundCounts,
  loggedIn,
  totalCount,
  totalDownloads,
  totalAttempts,
}: {
  // 배지/제목/소개 문단은 검색어와 무관한 정적 텍스트라 서버에서 그대로 렌더링해
  // 넘겨받는다 — 검색 인터랙션(SearchInput·스탯 타일)과 같은 히어로 섹션 안에
  // 나란히 있어야 하는 원래 레이아웃을 유지하기 위한 슬롯이다.
  heroText: ReactNode;
  allPapers: LightPaper[];
  subjects: Subject[];
  initialQuery: string;
  initialLevel?: string;
  initialPage: number;
  bookmarkedIds: string[];
  cbtAvailableIds: string[];
  myRoundCounts: Record<string, number>;
  loggedIn: boolean;
  totalCount: number | null;
  totalDownloads: number | null;
  totalAttempts: number | null;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [level, setLevel] = useState(initialLevel);
  const [page, setPage] = useState(initialPage);

  const bookmarkedSet = useMemo(() => new Set(bookmarkedIds), [bookmarkedIds]);
  const cbtAvailableSet = useMemo(() => new Set(cbtAvailableIds), [cbtAvailableIds]);

  const isSearching = query.trim().length > 0;
  const matchedSubjectIds = useMemo(
    () => matchSubjectIds(subjects, query),
    [subjects, query],
  );
  const filtered = useMemo(
    () => filterPapers(allPapers, { level, matchedSubjectIds, isSearching }),
    [allPapers, level, matchedSubjectIds, isSearching],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visiblePapers = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
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

  // 주소창 URL은 공유/새로고침용으로만 갱신한다 — 여기서 서버를 다시 부르지
  // 않도록 Next 라우터 대신 history API를 직접 쓴다.
  useEffect(() => {
    const timeout = setTimeout(() => {
      const usp = new URLSearchParams();
      if (query) usp.set("q", query);
      if (level) usp.set("level", level);
      if (safePage > 1) usp.set("page", String(safePage));
      const qs = usp.toString();
      window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
    }, URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query, level, safePage]);

  return (
    <>
      <section className="flex flex-col items-start gap-4">
        {heroText}

        <SearchInput value={query} onChange={handleQueryChange} />

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
          <button
            type="button"
            onClick={() => handleLevelChange(undefined)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              !level
                ? "bg-zinc-800 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
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
                level === lv
                  ? levelColor(lv)
                  : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
              }`}
            >
              {lv}
            </button>
          ))}
        </div>

        <SubjectIndexTabs subjects={subjects} />

        <p className="text-sm text-zinc-500">총 {filtered.length}개의 자료</p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visiblePapers.map((paper) => (
            <ExamCard
              key={paper.id}
              paper={paper as unknown as ExamPaper}
              linkLevel={level}
              myRoundCount={myRoundCounts[paper.id]}
              isBookmarked={bookmarkedSet.has(paper.id)}
              loggedIn={loggedIn}
              hasCbtAnswers={cbtAvailableSet.has(paper.id)}
            />
          ))}
          {visiblePapers.length === 0 && (
            <p className="col-span-full py-12 text-center text-zinc-500">
              조건에 맞는 기출문제가 없습니다.
            </p>
          )}
        </div>

        {totalPages > 1 && (
          <>
            <PageButtons
              currentPage={safePage}
              totalPages={totalPages}
              blockSize={5}
              onNavigate={setPage}
              className="flex sm:hidden"
            />
            <PageButtons
              currentPage={safePage}
              totalPages={totalPages}
              blockSize={10}
              onNavigate={setPage}
              className="hidden sm:flex"
            />
          </>
        )}
      </section>
    </>
  );
}
