"use client";

import { useMemo, useState, useEffect, useDeferredValue, useRef, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { FileStack, Download, Users, Star, Plus } from "lucide-react";
import { ExamCard } from "@/components/exam-card";
import { SearchInput } from "@/components/search-input";
import { WrongNoteShortcut } from "@/components/wrong-note-shortcut";
import { SubjectIndexTabs } from "@/components/subject-index-tabs";
import { SubjectQuickAdd } from "@/components/subject-quick-add";
import { levelColor } from "@/lib/level-colors";
import {
  filterPapers,
  matchSubjectIds,
  parseSearchQuery,
  getExamTypeNames,
  groupByYearAndSubject,
  decodePapers,
  type ExamTypeRef,
  type LightPaper,
  type PaperWire,
} from "@/lib/paper-search";
import { getSubjectNameForQuery } from "@gongmoa/core";
import type { Subject } from "@gongmoa/core";
import type { ExamPaper } from "@gongmoa/core";

const PAGE_SIZE = 24;
// 과목 인덱스(ㄱㄴㄷ) 바로 윗줄의 묶음 버튼. 급수 넷은 exam_papers.level로,
// 경찰·소방·계리직은 level이 비어 있어 시행처(exam_types.name)로 가른다.
const GROUPS: { label: string; level?: string; examType?: string }[] = [
  { label: "9급", level: "9급" },
  { label: "8급", level: "8급" },
  { label: "7급", level: "7급" },
  { label: "5급", level: "5급" },
  { label: "경찰", examType: "경찰" },
  { label: "소방", examType: "소방" },
  { label: "계리직", examType: "계리직" },
];
// 시행처 묶음은 급수 색(levelColor)에 해당하는 값이 없어 여기서 따로 정한다.
const EXAM_TYPE_COLORS: Record<string, string> = {
  경찰: "bg-sky-700 text-white",
  소방: "bg-red-600 text-white",
  계리직: "bg-emerald-600 text-white",
};
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
  papers,
  subjects,
  examTypes,
  initialQuery,
  initialLevel,
  initialExamType,
  initialPage,
  bookmarkedIds,
  bookmarkedSubjectIds,
  cbtMask,
  myRoundCounts,
  loggedIn,
  wrongNoteCount,
  totalCount,
  totalDownloads,
  totalAttempts,
}: {
  // 배지/제목/소개 문단은 검색어와 무관한 정적 텍스트라 서버에서 그대로 렌더링해
  // 넘겨받는다 — 검색 인터랙션(SearchInput)과 같은 히어로 섹션 안에
  // 나란히 있어야 하는 원래 레이아웃을 유지하기 위한 슬롯이다.
  heroText: ReactNode;
  // 문제지 전체 목록은 전송량을 줄인 튜플 표현으로 받아(paper-search의 PaperWire),
  // 여기서 한 번만 화면용 모양으로 복원한다.
  papers: PaperWire[];
  subjects: Subject[];
  examTypes: ExamTypeRef[];
  initialQuery: string;
  initialLevel?: string;
  initialExamType?: string;
  initialPage: number;
  bookmarkedIds: string[];
  bookmarkedSubjectIds: string[];
  // papers와 같은 순서로 "바로 풀기 가능 여부"를 담은 0/1 문자열 (home-data.ts 참고)
  cbtMask: string;
  myRoundCounts: Record<string, number>;
  loggedIn: boolean;
  // 마이페이지 "남은 오답"과 같은 미극복 오답 수. 0이면 배너를 숨긴다.
  wrongNoteCount: number;
  totalCount: number | null;
  totalDownloads: number | null;
  totalAttempts: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // 압축 표현 → 화면용 목록 복원. 과목·시행처 객체는 문제지끼리 공유하므로
  // (decodePapers 주석 참고) 배열 한 번 순회 수준의 비용이다.
  const allPapers = useMemo(
    () => decodePapers({ subjects, examTypes, papers }),
    [subjects, examTypes, papers],
  );
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
  // 경찰·소방·계리직 묶음은 급수가 아니라 시행처로 거르므로 별도 상태로 둔다
  // (둘 중 하나만 걸리도록 handleGroupChange에서 서로를 비운다).
  const [examTypeFilter, setExamTypeFilter] = useState<string | undefined>(() => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("type");
      if (fromUrl) return fromUrl;
    }
    return initialExamType;
  });
  // URL(?fav=1)을 우선하고, 없으면 지난번에 저장해둔 로컬 설정을 따른다.
  const [favOnly, setFavOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    const fromUrl = new URLSearchParams(window.location.search).get("fav");
    if (fromUrl === "1") return true;
    if (fromUrl === "0") return false;
    return window.localStorage.getItem(FAV_ONLY_STORAGE_KEY) === "1";
  });
  // + 버튼으로 여는 "과목 바로 추가" 패널. 기본은 접힌 상태.
  const [quickAddOpen, setQuickAddOpen] = useState(false);
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
  // 과목 즐겨찾기는 화면 안에서(+ 버튼 패널, 과목 인덱스) 바로 바뀌고, 그 즉시
  // "즐겨찾기한 과목만 보기" 결과에도 반영돼야 해서 서버 값을 초기값 삼아
  // 클라이언트 상태로 들고 있는다. 서버가 새 목록을 내려주면 그쪽으로 맞춘다.
  const [bookmarkedSubjectSet, setBookmarkedSubjectSet] = useState(
    () => new Set(bookmarkedSubjectIds),
  );
  useEffect(() => {
    setBookmarkedSubjectSet(new Set(bookmarkedSubjectIds));
  }, [bookmarkedSubjectIds]);
  function handleSubjectBookmarkToggled(subjectId: string, bookmarked: boolean) {
    setBookmarkedSubjectSet((prev) => {
      const next = new Set(prev);
      if (bookmarked) next.add(subjectId);
      else next.delete(subjectId);
      return next;
    });
    setPage(1);
  }
  const cbtAvailableSet = useMemo(() => {
    const set = new Set<string>();
    for (let i = 0; i < allPapers.length; i++) {
      if (cbtMask[i] === "1") set.add(allPapers[i].id);
    }
    return set;
  }, [allPapers, cbtMask]);
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
  const effectiveExamType = queryExamType ?? examTypeFilter;
  const isSearching = subjectQuery.trim().length > 0;
  const matchedSubjectIds = useMemo(
    () => matchSubjectIds(subjects, subjectQuery),
    [subjects, subjectQuery],
  );
  // 검색창 아래 뜨는 과목 추천(구글 자동완성처럼). 아래 카드 그리드와 같은 매칭
  // 규칙(matchedSubjectIds)을 그대로 재사용해 "카드로 보이는 과목"과 "추천으로
  // 뜨는 과목"이 항상 같은 목록이 되게 한다. 너무 길면 스크롤 없이 훑을 수 없어
  // 6개로 자른다 — 검색어를 더 좁히면 자연히 줄어든다.
  const subjectsById = useMemo(
    () => new Map(subjects.map((s) => [s.id, s])),
    [subjects],
  );
  const searchSuggestions = useMemo(() => {
    if (!isSearching) return [];
    return matchedSubjectIds
      .map((id) => subjectsById.get(id))
      .filter((s): s is Subject => !!s)
      .slice(0, 6)
      // 보여주는 이름은 방금 친 검색어에 맞춘다 — "행정법"을 쳤는데 추천이
      // "행정법총론"으로 뜨면 찾는 과목이 없어서 비슷한 걸 내준 것처럼 읽힌다.
      // 링크(slug)는 그대로라 눌러 가는 과목 페이지는 달라지지 않는다.
      .map((s) => {
        const name = getSubjectNameForQuery(s.name, subjectQuery);
        return name === s.name ? s : { ...s, name };
      });
  }, [isSearching, matchedSubjectIds, subjectsById, subjectQuery]);
  const filtered = useMemo(
    () =>
      filterPapers(allPapers, {
        level: effectiveLevel,
        year: queryYear,
        examType: effectiveExamType,
        matchedSubjectIds,
        isSearching,
        favOnly: effectiveFavOnly,
        bookmarkedSubjectIds: bookmarkedSubjectSet,
      }),
    [
      allPapers,
      effectiveLevel,
      queryYear,
      effectiveExamType,
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
  // 급수 묶음과 시행처 묶음은 한 줄에 나란히 있지만 서로 배타적이다 — 하나를
  // 고르면 다른 쪽 필터는 비워야 "9급 + 경찰"처럼 결과가 0건이 되는 조합을
  // 사용자가 모르게 만들지 않는다. 인자가 없으면 "전체"(둘 다 해제).
  function handleGroupChange(next?: { level?: string; examType?: string }) {
    setLevel(next?.level);
    setExamTypeFilter(next?.examType);
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

  // 상단 로고(홈 버튼)를 이미 홈에 있는 상태에서 누르면 site-header가 쏘는
  // 이벤트. 이 컴포넌트의 page는 Next 라우터가 모르는 클라이언트 상태라
  // "/"로의 Link만으로는 리렌더되지 않으므로 직접 1페이지로 되돌린다.
  useEffect(() => {
    function handleHomeReset() {
      setPage(1);
    }
    window.addEventListener("gongmoa:home-reset", handleHomeReset);
    return () => window.removeEventListener("gongmoa:home-reset", handleHomeReset);
  }, []);

  // 주소창 URL은 공유/새로고침용으로만 갱신한다 — 여기서 서버를 다시 부르지
  // 않도록 Next 라우터 대신 history API를 직접 쓴다.
  useEffect(() => {
    const timeout = setTimeout(() => {
      const usp = new URLSearchParams();
      if (query) usp.set("q", query);
      if (level) usp.set("level", level);
      if (examTypeFilter) usp.set("type", examTypeFilter);
      if (effectiveFavOnly) usp.set("fav", "1");
      if (safePage > 1) usp.set("page", String(safePage));
      const qs = usp.toString();
      window.history.replaceState(null, "", qs ? `/?${qs}` : "/");
    }, URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query, level, examTypeFilter, effectiveFavOnly, safePage]);

  return (
    <>
      <section className="flex flex-col items-start gap-4">
        {heroText}

        <SearchInput
          value={query}
          onChange={handleQueryChange}
          suggestions={searchSuggestions}
        />

        {/* 오답노트 바로가기: 로그인 상태이고 아직 극복 못 한 오답이 있을 때만
            검색창 바로 아래에 배너로 노출한다. */}
        {loggedIn && wrongNoteCount > 0 && (
          <WrongNoteShortcut count={wrongNoteCount} />
        )}

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
            {/* 자릿수 구분을 넣는다. 3790건이 "3790"으로 붙어 나오면 한눈에 안 읽힌다.
                로케일을 고정하는 건 서버 렌더와 클라이언트 렌더가 달라지면 하이드레이션이
                깨지기 때문이다. */}
            <strong className="text-lg tabular-nums">
              {(totalCount ?? 0).toLocaleString("ko-KR")}건
            </strong>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border-2 border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <Download size={20} className="text-blue-500" />
            <span className="whitespace-nowrap text-sm font-medium text-zinc-600 dark:text-zinc-400">
              누적 다운로드
            </span>
            <strong className="text-lg tabular-nums">
              {(totalDownloads ?? 0).toLocaleString("ko-KR")}회
            </strong>
          </div>
          <div className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border-2 border-zinc-200 px-4 py-3 dark:border-zinc-700">
            <Users size={20} className="text-blue-500" />
            <span className="whitespace-nowrap text-sm font-medium text-zinc-600 dark:text-zinc-400">
              실시간 총 응시 수
            </span>
            <strong className="text-lg tabular-nums">
              {(totalAttempts ?? 0).toLocaleString("ko-KR")}건
            </strong>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleFavOnly}
            aria-pressed={effectiveFavOnly}
            title={loggedIn ? undefined : "로그인 후 이용할 수 있어요"}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium ${
              effectiveFavOnly
                ? "border border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
                : "border border-zinc-200 text-zinc-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-amber-800 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
            }`}
          >
            <Star size={14} fill={effectiveFavOnly ? "currentColor" : "none"} />
            즐겨찾기한 과목만 보기
          </button>
          {/* 급수·직렬별로 과목을 바로 즐겨찾기에 넣을 수 있는 패널을 여닫는다. */}
          <button
            type="button"
            onClick={() => setQuickAddOpen((v) => !v)}
            aria-expanded={quickAddOpen}
            aria-label="즐겨찾기할 과목 추가"
            title="즐겨찾기할 과목 추가"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${
              quickAddOpen
                ? "border border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
                : "border border-zinc-200 text-zinc-600 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-amber-800 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
            }`}
          >
            <Plus
              size={16}
              className={quickAddOpen ? "rotate-45 transition-transform" : "transition-transform"}
            />
          </button>
        </div>

        {quickAddOpen && (
          <SubjectQuickAdd
            subjects={subjects}
            bookmarkedSubjectIds={bookmarkedSubjectSet}
            loggedIn={loggedIn}
            onToggle={handleSubjectBookmarkToggled}
          />
        )}
      </section>

      <section ref={resultsSectionRef} className="flex flex-col gap-4">
        {/* 모바일에서는 급수·시행처 버튼 8개가 두 줄로 접히며 첫 화면에서 카드
            목록을 밀어내서, 아래 과목 인덱스(ㄱㄴㄷ)와 같이 옆으로 스와이프하는
            한 줄로 압축한다(스크롤바는 숨김). sm 이상에서는 기존처럼 전부 펼친다. */}
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-visible sm:pb-0">
          <button
            type="button"
            onClick={() => handleGroupChange()}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium ${
              !effectiveLevel && !effectiveExamType
                ? "bg-zinc-800 text-white dark:bg-zinc-700"
                : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            전체
          </button>
          {GROUPS.map((g) => {
            const active = g.level
              ? effectiveLevel === g.level && !effectiveExamType
              : effectiveExamType === g.examType;
            return (
              <button
                key={g.label}
                type="button"
                onClick={() => handleGroupChange(g)}
                className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium ${
                  active
                    ? g.level
                      ? levelColor(g.level)
                      : EXAM_TYPE_COLORS[g.label]
                    : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
                }`}
              >
                {g.label}
              </button>
            );
          })}
        </div>

        <SubjectIndexTabs
          subjects={subjects}
          bookmarkedSubjectIds={bookmarkedSubjectSet}
          loggedIn={loggedIn}
          onToggle={handleSubjectBookmarkToggled}
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
