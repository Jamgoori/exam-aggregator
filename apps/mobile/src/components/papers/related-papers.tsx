import type { ExamPaper, Subject } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { ExamCard, ExamCardSkeleton } from "./exam-card";
import { ExamTypeChips, LevelChips } from "./paper-filter-chips";
import { AppText } from "../app-text";
import { QueryState } from "../query-state";
import { Skeleton } from "../skeleton";
import { useMyBookmarkedPaperIds } from "../../queries/bookmarks";
import { useCbtAvailability, useMyRoundCounts, useRelatedPapers } from "../../queries/papers";

// 문제지 상세 하단 "같은 과목 기출문제 목록"(웹 papers/[id]/page.tsx RelatedPapersSection):
// 급수 탭(그 과목에 실제 존재하는 급수가 2개 이상일 때만) + 직렬 다중 선택 탭 + 최근 12장.
// 필터 상태는 라우트 params(?level, ?examTypes) — 웹 링크와 같은 파라미터.
export function RelatedPapersSection({
  paper,
  subject,
  level,
  selectedExamTypeIds,
  onChangeLevel,
  onChangeExamTypes,
}: {
  paper: ExamPaper;
  subject: Subject;
  level: string | undefined;
  selectedExamTypeIds: Set<string>;
  onChangeLevel: (level: string | undefined) => void;
  onChangeExamTypes: (next: Set<string>) => void;
}) {
  const examTypeIds = useMemo(() => [...selectedExamTypeIds], [selectedExamTypeIds]);
  const related = useRelatedPapers(paper, level, examTypeIds);
  const roundCounts = useMyRoundCounts().data;
  const { set: bookmarkedSet } = useMyBookmarkedPaperIds();
  const otherIds = useMemo(
    () => (related.data?.papers ?? []).map((p) => p.id).filter((id) => id !== paper.id),
    [related.data, paper.id],
  );
  const { set: cbtSet } = useCbtAvailability(otherIds);

  return (
    <QueryState query={related} skeleton={<RelatedPapersSkeleton />} isEmpty={(d) => !d || d.papers.length === 0} empty={<View />}>
      {(data) => {
        if (!data) return null;
        return (
          <View className="gap-4 border-t border-zinc-100 pt-14 dark:border-zinc-700">
            <View className="flex-row items-center justify-between gap-4">
              <AppText variant="lg" weight="semibold" className="min-w-0 flex-1">
                {subject.name} 기출문제 목록
              </AppText>
              <Pressable
                accessibilityRole="link"
                onPress={() =>
                  router.push(`/subjects/${subject.slug}${level ? `?level=${encodeURIComponent(level)}` : ""}` as Href)
                }
                hitSlop={6}
              >
                <AppText variant="sm" weight="medium" className="shrink-0 text-blue-600 dark:text-blue-400">
                  전체보기
                </AppText>
              </Pressable>
            </View>

            {data.availableLevels.length > 1 && (
              <LevelChips levels={data.availableLevels} value={level} onChange={onChangeLevel} />
            )}
            {data.availableExamTypes.length > 1 && (
              <ExamTypeChips examTypes={data.availableExamTypes} selectedIds={selectedExamTypeIds} onChange={onChangeExamTypes} />
            )}

            <View className="gap-4">
              {data.papers.length === 0 && (
                <AppText className="py-8 text-center text-zinc-500 dark:text-zinc-500">
                  조건에 맞는 기출문제가 없습니다.
                </AppText>
              )}
              {data.papers.map((p) => (
                <ExamCard
                  key={p.id}
                  paper={p}
                  isCurrent={p.id === paper.id}
                  myRoundCount={roundCounts?.[p.id]}
                  isBookmarked={bookmarkedSet.has(p.id)}
                  hasCbtAnswers={cbtSet.has(p.id)}
                />
              ))}
            </View>
          </View>
        );
      }}
    </QueryState>
  );
}

// 하단 섹션 자리에 깔리는 스켈레톤(웹 RelatedPapersSkeleton).
export function RelatedPapersSkeleton() {
  return (
    <View className="gap-4 border-t border-zinc-100 pt-14 dark:border-zinc-700">
      <View className="flex-row items-center justify-between gap-4">
        <Skeleton className="h-5 w-40 rounded-lg" />
        <Skeleton className="h-4 w-14 rounded-lg" />
      </View>
      <View className="flex-row flex-wrap gap-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-14 rounded-full" delay={i * 60} />
        ))}
      </View>
      <View className="gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <ExamCardSkeleton key={i} delay={i * 80} />
        ))}
      </View>
    </View>
  );
}
