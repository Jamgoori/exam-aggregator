import {
  filterPapers,
  getExamTypeNames,
  getSubjectNameForQuery,
  groupByYearAndSubject,
  levelColor,
  matchSubjectIds,
  papersGroupColor,
  parseSearchQuery,
  type LightPaper,
  type Subject,
} from "@gongmoa/core";
import { router, useLocalSearchParams } from "expo-router";
import { Plus, Star } from "lucide-react-native";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { ExamCard, ExamCardSkeleton } from "./exam-card";
import { ALL_CHIP_CLASS, ChipRow, FilterChip } from "./paper-filter-chips";
import { SearchInput } from "./search-input";
import { SubjectIndexTabs } from "./subject-index-tabs";
import { SubjectQuickAdd } from "./subject-quick-add";
import { AppText } from "../app-text";
import { LoginPrompt } from "../login-prompt";
import { Pagination } from "../pagination";
import { QueryState } from "../query-state";
import { Screen } from "../screen";
import { Skeleton } from "../skeleton";
import { kvGet, kvSet } from "../../lib/kv";
import { useMyBookmarkedPaperIds, useMyBookmarkedSubjectIds } from "../../queries/bookmarks";
import { useCatalog, useDecodedPapers } from "../../queries/catalog";
import { useMyRoundCounts } from "../../queries/papers";
import { useAuth } from "../../providers/auth-provider";
import { useIsDark } from "../../theme";

// 기출문제 검색·목록(웹 app/papers/page.tsx + components/exam-browser.tsx, 설계서 §4.5 #20).
// 웹처럼 전체 목록(PaperWire + cbtMask)을 받아 클라이언트에서 거른다. `?q,level,type,fav,page`
// 는 라우트 params 로 읽고(딥링크·복귀), 바뀌면 200ms 뒤 setParams 로 되쓴다(공유용).
// 통계 타일 3개는 웹 sm 이상 전용이라 그리지 않고 "총 자료 수"만 소개 문장에 통합한다
// (papers/page.tsx 의 모바일 전용 소개 문단). AdBanner(papersList)는 Phase 5(§12-2 14번).
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
const URL_SYNC_DEBOUNCE_MS = 200;
// "즐겨찾기한 과목만 보기" 설정을 다음 방문에도 기억해두기 위한 kv 키(웹 localStorage 와 동일).
const FAV_ONLY_STORAGE_KEY = "examAggregator:favOnly";

type Params = { q?: string; level?: string; type?: string; fav?: string; page?: string };

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

const EMPTY_SUBJECTS: Subject[] = [];

export function PapersBrowser({
  // "기출문제" 탭 재탭 → 1페이지(웹 gongmoa:browser-reset 이벤트). 값이 바뀔 때마다 되돌린다.
  resetSignal = 0,
}: {
  resetSignal?: number;
}) {
  const params = useLocalSearchParams<Params>();
  const { userId } = useAuth();
  const loggedIn = !!userId;
  const dark = useIsDark();

  const catalog = useCatalog();
  const allPapers = useDecodedPapers(catalog.data);
  const subjects = catalog.data?.subjects ?? EMPTY_SUBJECTS;
  const cbtMask = catalog.data?.cbtMask ?? "";
  const roundCounts = useMyRoundCounts().data;
  const { set: bookmarkedSet } = useMyBookmarkedPaperIds();
  const { set: bookmarkedSubjectSet } = useMyBookmarkedSubjectIds();

  const [query, setQuery] = useState(params.q ?? "");
  const [level, setLevel] = useState<string | undefined>(params.level || undefined);
  // 경찰·소방·계리직 묶음은 급수가 아니라 시행처로 거르므로 별도 상태(둘 중 하나만).
  const [examTypeFilter, setExamTypeFilter] = useState<string | undefined>(params.type || undefined);
  // URL(?fav=1)을 우선하고, 없으면 지난번에 저장해둔 로컬 설정을 따른다(아래 효과).
  const [favOnly, setFavOnly] = useState(params.fav === "1");
  const [favPrompt, setFavPrompt] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [page, setPage] = useState(parsePage(params.page));

  useEffect(() => {
    if (params.fav === "1" || params.fav === "0") return;
    let alive = true;
    kvGet(FAV_ONLY_STORAGE_KEY).then((v) => {
      if (alive && v === "1") setFavOnly(true);
    });
    return () => {
      alive = false;
    };
    // 마운트 시 한 번.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 재탭 신호는 렌더 중에 "prop 변화에 상태 맞추기"로 처리한다(효과 안 setState 없음).
  const [seenReset, setSeenReset] = useState(resetSignal);
  if (seenReset !== resetSignal) {
    setSeenReset(resetSignal);
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

  // 입력창은 즉시 반응하되 카드 목록 재배치만 한 박자 늦춘다(웹과 같은 useDeferredValue).
  const deferredQuery = useDeferredValue(query);
  const examTypeNames = useMemo(() => getExamTypeNames(allPapers), [allPapers]);
  const { level: queryLevel, year: queryYear, examType: queryExamType, subjectQuery } = useMemo(
    () => parseSearchQuery(deferredQuery, examTypeNames),
    [deferredQuery, examTypeNames],
  );
  const effectiveLevel = queryLevel ?? level;
  const effectiveExamType = queryExamType ?? examTypeFilter;
  const isSearching = subjectQuery.trim().length > 0;
  const matchedSubjectIds = useMemo(() => matchSubjectIds(subjects, subjectQuery), [subjects, subjectQuery]);
  const subjectsById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const searchSuggestions = useMemo(() => {
    if (!isSearching) return [];
    return matchedSubjectIds
      .map((id) => subjectsById.get(id))
      .filter((s): s is Subject => !!s)
      .slice(0, 6)
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
    [allPapers, effectiveLevel, queryYear, effectiveExamType, matchedSubjectIds, isSearching, effectiveFavOnly, bookmarkedSubjectSet],
  );

  const favSortedPapers = useMemo(() => {
    if (!effectiveFavOnly) return [];
    const flat: LightPaper[] = [];
    for (const bySubject of groupByYearAndSubject(filtered).values()) {
      for (const papers of bySubject.values()) flat.push(...papers);
    }
    return flat;
  }, [effectiveFavOnly, filtered]);

  const totalPages = Math.max(1, Math.ceil((effectiveFavOnly ? favSortedPapers.length : filtered.length) / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visiblePapers = (effectiveFavOnly ? favSortedPapers : filtered).slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const groupedByYear = useMemo(
    () => (effectiveFavOnly ? groupByYearAndSubject(visiblePapers) : null),
    [effectiveFavOnly, visiblePapers],
  );

  function handleQueryChange(next: string) {
    setQuery(next);
    setPage(1);
  }
  // 급수 묶음과 시행처 묶음은 서로 배타적 — 하나를 고르면 다른 쪽을 비운다. 인자 없으면 "전체".
  function handleGroupChange(next?: { level?: string; examType?: string }) {
    setLevel(next?.level);
    setExamTypeFilter(next?.examType);
    setPage(1);
  }
  function handleToggleFavOnly() {
    if (!loggedIn) {
      // 게스트 모드(§7.0): 버튼을 숨기지 않고 그 자리에 로그인 안내를 그린다.
      setFavPrompt(true);
      return;
    }
    const next = !favOnly;
    setFavOnly(next);
    setPage(1);
    void kvSet(FAV_ONLY_STORAGE_KEY, next ? "1" : "0");
  }
  function handleSubjectBookmarkToggled() {
    setPage(1);
  }

  // 주소 파라미터는 공유·복귀용으로만 갱신한다(타이핑을 막지 않도록 살짝 늦춘다).
  useEffect(() => {
    const timeout = setTimeout(() => {
      router.setParams({
        q: query || undefined,
        level: level || undefined,
        type: examTypeFilter || undefined,
        fav: effectiveFavOnly ? "1" : undefined,
        page: safePage > 1 ? String(safePage) : undefined,
      } as Record<string, string>);
    }, URL_SYNC_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [query, level, examTypeFilter, effectiveFavOnly, safePage]);

  const totalCount = allPapers.length;
  const amberOn =
    "border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30";
  const amberOff =
    "border border-zinc-200 active:border-amber-300 active:bg-amber-50 dark:border-zinc-700 dark:active:border-amber-800 dark:active:bg-amber-950/30";
  const starColor = effectiveFavOnly ? (dark ? "#ffb900" : "#e17100") : dark ? "#9f9fa9" : "#52525c";

  return (
    <Screen contentClassName="gap-6" refreshing={catalog.isRefetching} onRefresh={() => void catalog.refetch()}>
      <View className="items-start gap-4">
        {/* 제목 한 줄과 범위 한 줄만 남기고 바로 검색창이 오게 한다. */}
        <View className="gap-1">
          <AppText variant="2xl" weight="bold" className="tracking-tight text-black dark:text-zinc-100">
            기출문제 검색
          </AppText>
          <AppText className="text-zinc-600 dark:text-zinc-400" pretty>
            국가직·지방직·소방·경찰 등 주요 공무원 시험 기출문제{" "}
            {totalCount ? (
              <>
                <AppText weight="semibold" className="text-zinc-800 dark:text-zinc-200">
                  {totalCount.toLocaleString()}건
                </AppText>
                을{" "}
              </>
            ) : (
              "를 "
            )}
            연도별·과목별로 정리했어요.
          </AppText>
        </View>

        <SearchInput value={query} onChange={handleQueryChange} suggestions={searchSuggestions} />

        {/* WrongNoteShortcut(미극복 오답 배너)은 오답노트 스트림(Phase 2)에서 이 자리에 붙는다. */}

        <View className="mt-2 flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: effectiveFavOnly }}
            accessibilityHint={loggedIn ? undefined : "로그인 후 이용할 수 있어요"}
            onPress={handleToggleFavOnly}
            className={["flex-row items-center gap-1.5 rounded-full px-4 py-1.5", effectiveFavOnly ? amberOn : amberOff].join(" ")}
          >
            <Star size={14} color={starColor} fill={effectiveFavOnly ? starColor : "none"} />
            <AppText
              variant="sm"
              weight="medium"
              className={effectiveFavOnly ? "text-amber-600 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-400"}
            >
              즐겨찾기한 과목만 보기
            </AppText>
          </Pressable>
          {/* 급수·직렬별로 과목을 바로 즐겨찾기에 넣을 수 있는 패널을 여닫는다. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="즐겨찾기할 과목 추가"
            accessibilityState={{ expanded: quickAddOpen }}
            onPress={() => setQuickAddOpen((v) => !v)}
            className={["h-8 w-8 shrink-0 items-center justify-center rounded-full", quickAddOpen ? amberOn : amberOff].join(" ")}
          >
            <Plus
              size={16}
              color={quickAddOpen ? (dark ? "#ffb900" : "#e17100") : dark ? "#9f9fa9" : "#52525c"}
              style={{ transform: [{ rotate: quickAddOpen ? "45deg" : "0deg" }] }}
            />
          </Pressable>
        </View>

        {favPrompt && !loggedIn && <LoginPrompt message="로그인 후 이용할 수 있어요" className="w-full" />}

        {quickAddOpen && <SubjectQuickAdd subjects={subjects} onToggle={handleSubjectBookmarkToggled} />}
      </View>

      <QueryState
        query={catalog}
        skeleton={<PapersSkeleton />}
      >
        {() => (
          <View className="gap-4">
            <ChipRow>
              <FilterChip
                label="전체"
                active={!effectiveLevel && !effectiveExamType}
                activeClass={ALL_CHIP_CLASS}
                onPress={() => handleGroupChange()}
              />
              {GROUPS.map((g) => {
                const active = g.level ? effectiveLevel === g.level && !effectiveExamType : effectiveExamType === g.examType;
                return (
                  <FilterChip
                    key={g.label}
                    label={g.label}
                    active={active}
                    activeClass={g.level ? levelColor(g.level) : (papersGroupColor(g.label) ?? levelColor(g.label))}
                    onPress={() => handleGroupChange(g)}
                  />
                );
              })}
            </ChipRow>

            <SubjectIndexTabs subjects={subjects} onToggle={handleSubjectBookmarkToggled} />

            <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
              총 {filtered.length}개의 자료
            </AppText>

            {groupedByYear ? (
              <View className="gap-8">
                {filtered.length === 0 && (
                  <AppText className="py-12 text-center text-zinc-500 dark:text-zinc-500" pretty>
                    {bookmarkedSubjectSet.size === 0
                      ? "아직 즐겨찾기한 과목이 없어요. 과목 옆의 별 아이콘을 눌러 추가해보세요."
                      : "조건에 맞는 기출문제가 없습니다."}
                  </AppText>
                )}
                {[...groupedByYear.entries()].map(([year, bySubject]) => (
                  <View key={year} className="gap-4">
                    <AppText variant="lg" weight="bold">
                      {year}년
                    </AppText>
                    {[...bySubject.entries()].map(([subjectName, papers]) => (
                      <View key={subjectName} className="gap-3">
                        <AppText variant="sm" weight="semibold" className="text-zinc-500 dark:text-zinc-500">
                          {subjectName}
                        </AppText>
                        <View className="gap-4">
                          {papers.map((paper) => (
                            <ExamCard
                              key={paper.id}
                              paper={paper}
                              myRoundCount={roundCounts?.[paper.id]}
                              isBookmarked={bookmarkedSet.has(paper.id)}
                              hasCbtAnswers={cbtAvailableSet.has(paper.id)}
                            />
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            ) : (
              <View className="gap-4">
                {visiblePapers.map((paper) => (
                  <ExamCard
                    key={paper.id}
                    paper={paper}
                    myRoundCount={roundCounts?.[paper.id]}
                    isBookmarked={bookmarkedSet.has(paper.id)}
                    hasCbtAnswers={cbtAvailableSet.has(paper.id)}
                  />
                ))}
                {visiblePapers.length === 0 && (
                  <AppText className="py-12 text-center text-zinc-500 dark:text-zinc-500">
                    조건에 맞는 기출문제가 없습니다.
                  </AppText>
                )}
              </View>
            )}

            <Pagination currentPage={safePage} totalPages={totalPages} onChange={setPage} />
          </View>
        )}
      </QueryState>
    </Screen>
  );
}

// 웹 papers/loading.tsx 의 목록 부분(제목·검색창은 이미 그려져 있으므로 그 아래만).
function PapersSkeleton() {
  return (
    <View className="gap-4">
      <View className="flex-row gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-16 rounded-full" delay={i * 60} />
        ))}
      </View>
      <View className="gap-4">
        {Array.from({ length: 8 }, (_, i) => (
          <ExamCardSkeleton key={i} delay={i * 80} />
        ))}
      </View>
    </View>
  );
}
