import type { ExamCombo } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import NotFoundScreen from "../+not-found";
import { AppText } from "../../src/components/app-text";
import { ExamAllPapersList, ExamAllYearsList } from "../../src/components/exams/exam-paper-lists";
import { ExamYearNav } from "../../src/components/exams/exam-year-nav";
import { InlineAlert } from "../../src/components/feedback";
import { Pagination } from "../../src/components/pagination";
import { ExamCard, ExamCardSkeleton } from "../../src/components/papers/exam-card";
import { KHE_EXAM_TYPE_NAME } from "../../src/components/papers/subject-index-tabs";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { useSetScreenParams } from "../../src/lib/screen-params";
import { useMyBookmarkedPaperIds } from "../../src/queries/bookmarks";
import { useExamCombo, useExamPapers } from "../../src/queries/exams";
import { useMyRoundCounts } from "../../src/queries/papers";

// `/exams/[exam]?year=`(설계서 §5 행) — 웹 app/exams/[exam]/page.tsx 1:1: 크럼("← 홈으로 ·
// 시험별 기출문제") → 제목 → 연도 줄 → 그 해의 카드 목록 → 연도별 전체 목록 → "과목별 기출문제 →".
//
// 연도는 별도 주소가 아니라 같은 화면의 필터다(웹 lib/exam-index.ts 머리말 — 연도마다
// 라우트를 두면 시험 18개 × 연도 14년 = 250장짜리 화면 무더기가 생기는데 대부분 카드 몇
// 장이라 과목 화면에 이미 실린 목록을 다시 늘어놓는 것뿐이었다).
//
// 없는 연도를 찍고 들어오면 404 대신 최신 연도를 보여준다 — 주소가 틀렸다기보다 고를 수
// 있는 값 중 하나를 잘못 적은 것에 가깝다(웹과 같은 판단).
//
// 앱만의 적응 하나: 카드 목록을 24장씩 나눈다(과목 화면과 같은 PAGE_SIZE). 웹은 한 해를
// 통째로 그리지만 폰에서는 1열이라 2026년 국가직 9급처럼 수십 장인 해가 끝없이 이어진다.
const PAGE_SIZE = 24;

type Params = { exam: string; year?: string; page?: string };

function decodeSlug(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    // 잘못 인코딩된 딥링크. 원문 그대로 찾아보고 없으면 아래에서 404 로 떨어진다.
    return value;
  }
}

export default function ExamComboRoute() {
  const params = useLocalSearchParams<Params>();
  const slug = decodeSlug(params.exam);
  const { query, combo } = useExamCombo(slug);

  if (combo === undefined) {
    return (
      <Screen contentClassName="gap-6">
        {query.isError ? (
          <InlineAlert
            message={query.error instanceof Error ? query.error.message : "시험 목록을 불러오지 못했어요."}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <ExamComboSkeleton />
        )}
      </Screen>
    );
  }
  if (combo === null) return <NotFoundScreen />;
  return <ExamComboScreen combo={combo} params={params} />;
}

function ExamComboScreen({ combo, params }: { combo: ExamCombo; params: Params }) {
  const { query, papers } = useExamPapers(combo.slug);
  const setScreenParams = useSetScreenParams();
  const roundCounts = useMyRoundCounts().data;
  const { set: bookmarkedSet } = useMyBookmarkedPaperIds();

  // 한능검은 연도가 목록을 가르는 축이 아니다 — 회차(제50~79회)가 곧 시험 한 장이고 한 해에
  // 4~6회가 들어 있어, 연도로 자르면 "2026년 4건"처럼 토막만 보인다(웹과 같은 분기).
  const singleList = combo.examTypeName === KHE_EXAM_TYPE_NAME;

  const requested = Number(params.year);
  const year = combo.years.includes(requested) ? requested : combo.years[0];

  const visibleAll = useMemo(
    () => (singleList ? (papers ?? []) : (papers ?? []).filter((p) => p.year === year)),
    [papers, singleList, year],
  );

  const currentPage = Math.max(1, Number(params.page) || 1);
  const totalPages = Math.max(1, Math.ceil(visibleAll.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const visible = useMemo(
    () => visibleAll.slice(pageStart, pageStart + PAGE_SIZE),
    [visibleAll, pageStart],
  );

  return (
    <Screen contentClassName="gap-6" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      {/* 상위 계층으로 되짚어 올라가는 크럼(웹 ExamCrumbs). */}
      <View>
        <View className="flex-row flex-wrap items-center gap-x-2">
          <Pressable accessibilityRole="link" onPress={() => router.navigate("/")} hitSlop={6}>
            <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
              ← 홈으로
            </AppText>
          </Pressable>
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500" accessibilityElementsHidden>
            ·
          </AppText>
          <Pressable accessibilityRole="link" onPress={() => router.push("/exams" as Href)} hitSlop={6}>
            <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
              시험별 기출문제
            </AppText>
          </Pressable>
        </View>
        {/* 제목이 이미 "국가직 9급 기출문제"라 급수 배지를 따로 달지 않는다. */}
        <AppText variant="3xl" weight="bold" accessibilityRole="header" className="mt-2" pretty>
          {combo.label} 기출문제
        </AppText>
      </View>

      {!singleList && (
        <View className="gap-3">
          <AppText variant="lg" weight="semibold" accessibilityRole="header">
            연도별 기출문제
          </AppText>
          <ExamYearNav
            combo={combo}
            activeYear={year}
            onChange={(next) => setScreenParams({ year: String(next), page: undefined })}
          />
        </View>
      )}

      <View className={singleList ? "gap-4" : "mt-6 gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-800"}>
        <AppText variant="lg" weight="semibold" accessibilityRole="header" pretty>
          {singleList
            ? `${combo.label} 기출문제 ${visibleAll.length.toLocaleString()}건`
            : `${year}년 ${combo.label} 기출문제 ${visibleAll.length.toLocaleString()}건`}
        </AppText>

        <QueryState
          query={query}
          skeleton={<CardsSkeleton />}
          isEmpty={() => visibleAll.length === 0}
          empty={
            <AppText className="py-12 text-center text-zinc-500 dark:text-zinc-500">
              아직 업로드된 기출문제가 없습니다.
            </AppText>
          }
        >
          {() => (
            <View className="gap-4">
              {visible.map((paper) => (
                <ExamCard
                  key={paper.id}
                  paper={paper}
                  myRoundCount={roundCounts?.[paper.id]}
                  isBookmarked={bookmarkedSet.has(paper.id)}
                  hasCbtAnswers={paper.hasCbtAnswers}
                />
              ))}
            </View>
          )}
        </QueryState>

        <Pagination
          currentPage={safePage}
          totalPages={totalPages}
          onChange={(page) => setScreenParams({ page: page > 1 ? String(page) : undefined })}
        />
      </View>

      {singleList ? (
        <ExamAllPapersList combo={combo} papers={papers ?? []} />
      ) : (
        <ExamAllYearsList combo={combo} papers={papers ?? []} />
      )}

      <View className="border-t border-zinc-100 pt-6 dark:border-zinc-800">
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/subjects" as Href)}
          hitSlop={6}
          className="self-start"
        >
          <AppText weight="medium" className="text-blue-600 dark:text-blue-400">
            과목별 기출문제 →
          </AppText>
        </Pressable>
      </View>
    </Screen>
  );
}

// 웹 exams/[exam] 의 ExamYearSectionSkeleton + ExamPaperGridSkeleton.
function ExamComboSkeleton() {
  return (
    <View className="gap-6">
      <View className="gap-3">
        <Skeleton className="h-4 w-40 rounded-lg" />
        <Skeleton className="h-9 w-56 rounded-lg" />
      </View>
      <View className="flex-row flex-wrap gap-2">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-full" delay={i * 40} />
        ))}
      </View>
      <Skeleton className="h-6 w-64 rounded-lg" />
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
