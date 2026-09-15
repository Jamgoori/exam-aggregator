import type { ExamPaper, Subject } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { ChevronRight, Shuffle } from "lucide-react-native";
import { useMemo } from "react";
import { Alert, Pressable, View } from "react-native";
import NotFoundScreen from "../../+not-found";
import { AppText } from "../../../src/components/app-text";
import { InlineAlert } from "../../../src/components/feedback";
import { Pagination } from "../../../src/components/pagination";
import { ExamCard, ExamCardSkeleton } from "../../../src/components/papers/exam-card";
import { ExamTypeChips, LevelChips, parseExamTypesParam } from "../../../src/components/papers/paper-filter-chips";
import { SubjectBookmarkButton } from "../../../src/components/papers/subject-bookmark-button";
import { QueryState } from "../../../src/components/query-state";
import { Screen } from "../../../src/components/screen";
import { Skeleton } from "../../../src/components/skeleton";
import { useSetScreenParams } from "../../../src/lib/screen-params";
import { useMyBookmarkedPaperIds } from "../../../src/queries/bookmarks";
import { useCbtAvailability, useMyRoundCounts } from "../../../src/queries/papers";
import { useSubjectBySlug, useSubjectFilters, useSubjectPapers } from "../../../src/queries/subjects";
import { themedIcon } from "../../../src/theme/icons";

// `/subjects/[slug]?level&examTypes&page`(설계서 §5 행) — 웹 app/subjects/[slug]/page.tsx 1:1:
// 크럼 → 제목 + 과목 즐겨찾기 → N건 → 섞어풀기 입구(필터 없을 때만) → 급수 탭 → 직렬 탭 →
// 카드 목록(24/페이지, 중복 통합 후 메모리 페이지네이션) → Pagination. 기출 섞어풀기
// (/subjects/[slug]/mix)는 Phase 2 라 지금은 Alert 로 안내한다.
const PAGE_SIZE = 24;
const ChevronIcon = themedIcon(ChevronRight);

type Params = { slug: string; level?: string; examTypes?: string; page?: string };

export default function SubjectRoute() {
  const params = useLocalSearchParams<Params>();
  const { query, subject } = useSubjectBySlug(params.slug);

  if (subject === undefined) {
    return (
      <Screen contentClassName="gap-6">
        {query.isError ? (
          <InlineAlert
            message={query.error instanceof Error ? query.error.message : "과목을 불러오지 못했어요."}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <SubjectSkeleton />
        )}
      </Screen>
    );
  }
  if (subject === null) return <NotFoundScreen />;
  return <SubjectScreen subject={subject} params={params} />;
}

function SubjectScreen({ subject, params }: { subject: Subject; params: Params }) {
  const level = params.level || undefined;
  const selectedExamTypeIds = useMemo(() => parseExamTypesParam(params.examTypes), [params.examTypes]);
  const examTypeIds = useMemo(() => [...selectedExamTypeIds], [selectedExamTypeIds]);
  const currentPage = Math.max(1, Number(params.page) || 1);
  const setScreenParams = useSetScreenParams();

  const filters = useSubjectFilters(subject.id);
  const papers = useSubjectPapers(subject.id, level, examTypeIds);
  const roundCounts = useMyRoundCounts().data;
  const { set: bookmarkedSet } = useMyBookmarkedPaperIds();

  const deduped = useMemo(() => papers.data ?? [], [papers.data]);
  const totalPages = Math.max(1, Math.ceil(deduped.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visible = useMemo(() => deduped.slice(pageStart, pageStart + PAGE_SIZE), [deduped, pageStart]);
  const visibleIds = useMemo(() => visible.map((p) => p.id), [visible]);
  const { set: cbtSet } = useCbtAvailability(visibleIds);

  function setFilter(next: { level?: string; examTypes?: Set<string>; page?: number }) {
    const nextLevel = "level" in next ? next.level : level;
    const nextTypes = next.examTypes ?? selectedExamTypeIds;
    const nextPage = next.page ?? 1;
    setScreenParams({
      level: nextLevel || undefined,
      examTypes: nextTypes.size > 0 ? [...nextTypes].join(",") : undefined,
      page: nextPage > 1 ? String(nextPage) : undefined,
    });
  }

  const noFilter = !level && selectedExamTypeIds.size === 0;

  return (
    <Screen contentClassName="gap-6" refreshing={papers.isRefetching} onRefresh={() => void papers.refetch()}>
      <View>
        <View className="flex-row flex-wrap items-center gap-x-2">
          <Pressable accessibilityRole="link" onPress={() => router.navigate("/")} hitSlop={6}>
            <AppText variant="sm" className="text-zinc-500 underline dark:text-zinc-500">
              ← 홈으로
            </AppText>
          </Pressable>
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500" accessibilityElementsHidden>
            ·
          </AppText>
          <Pressable accessibilityRole="link" onPress={() => router.push("/subjects" as Href)} hitSlop={6}>
            <AppText variant="sm" className="text-zinc-500 underline dark:text-zinc-500">
              과목별 기출문제
            </AppText>
          </Pressable>
        </View>
        <View className="mt-2 flex-row items-center gap-2">
          <AppText variant="3xl" weight="semibold" className="min-w-0 shrink" pretty>
            {subject.name} 기출문제
          </AppText>
          <SubjectBookmarkButton subjectId={subject.id} />
        </View>
        {deduped.length > 0 && (
          <AppText variant="sm" className="mt-2 text-zinc-500 dark:text-zinc-500">
            {deduped.length.toLocaleString()}건
          </AppText>
        )}
      </View>

      {/* 기출 섞어풀기 입구 — 시행처를 가리지 않고 섞이는 것이 요점이라 시행처 탭보다 위. */}
      {deduped.length > 0 && noFilter && (
        <Pressable
          accessibilityRole="link"
          onPress={() => Alert.alert("섞어풀기는 다음 단계에서 열려요")}
          className="flex-row items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3.5 active:border-blue-300 active:bg-blue-100/70 dark:border-blue-900/50 dark:bg-blue-950/25 dark:active:bg-blue-950/40"
        >
          <View className="h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600">
            <Shuffle size={18} color="#ffffff" />
          </View>
          <View className="min-w-0 flex-1">
            <AppText variant="sm" weight="bold" className="text-blue-900 dark:text-blue-200">
              {subject.name} 기출 섞어풀기
            </AppText>
            <AppText variant="xs" className="text-blue-800/80 dark:text-blue-300/80" pretty>
              시험 구분 없이 {subject.name} 기출을 무작위로 섞어 원하는 문항 수만큼 풀어요. 결과는 오답노트에 날짜별로 남아요.
            </AppText>
          </View>
          <ChevronIcon size={18} colorClassName="text-blue-400" />
        </Pressable>
      )}

      {filters.data && filters.data.levels.length > 1 && (
        <LevelChips levels={filters.data.levels} value={level} onChange={(next) => setFilter({ level: next })} />
      )}
      {filters.data && filters.data.examTypes.length > 1 && (
        <ExamTypeChips examTypes={filters.data.examTypes} selectedIds={selectedExamTypeIds} onChange={(next) => setFilter({ examTypes: next })} />
      )}

      <QueryState
        query={papers}
        skeleton={<CardsSkeleton />}
        empty={
          <AppText className="py-12 text-center text-zinc-500 dark:text-zinc-500">
            {filters.data && !filters.data.hasAnyPaper ? "아직 업로드된 기출문제가 없습니다." : "조건에 맞는 기출문제가 없습니다."}
          </AppText>
        }
      >
        {() => (
          <View className="gap-4">
            {visible.map((paper: ExamPaper) => (
              <ExamCard
                key={paper.id}
                paper={paper}
                myRoundCount={roundCounts?.[paper.id]}
                isBookmarked={bookmarkedSet.has(paper.id)}
                hasCbtAnswers={cbtSet.has(paper.id)}
              />
            ))}
          </View>
        )}
      </QueryState>

      <Pagination currentPage={safePage} totalPages={totalPages} onChange={(page) => setFilter({ page })} />
    </Screen>
  );
}

// 웹 subjects/[slug]/loading.tsx.
function SubjectSkeleton() {
  return (
    <View className="gap-6">
      <View className="gap-3">
        <Skeleton className="h-4 w-20 rounded-lg" />
        <View className="flex-row items-center gap-3">
          <Skeleton className="h-9 w-48 rounded-lg" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </View>
        <Skeleton className="h-4 w-40 rounded-lg" />
      </View>
      <View className="flex-row gap-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-14 rounded-full" delay={i * 60} />
        ))}
      </View>
      <CardsSkeleton />
    </View>
  );
}

function CardsSkeleton() {
  return (
    <View className="gap-4">
      {Array.from({ length: 8 }, (_, i) => (
        <ExamCardSkeleton key={i} delay={i * 80} />
      ))}
    </View>
  );
}
