"use client";

import { useMemo, useState, useEffect } from "react";
import { ExamCard } from "@/components/exam-card";
import { SearchInput } from "@/components/search-input";
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
  allPapers,
  subjects,
  initialQuery,
  initialLevel,
  initialPage,
  bookmarkedIds,
  cbtAvailableIds,
  myRoundCounts,
  loggedIn,
}: {
  allPapers: LightPaper[];
  subjects: Subject[];
  initialQuery: string;
  initialLevel?: string;
  initialPage: number;
  bookmarkedIds: string[];
  cbtAvailableIds: string[];
  myRoundCounts: Record<string, number>;
  loggedIn: boolean;
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
      <SearchInput value={query} onChange={handleQueryChange} />

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
