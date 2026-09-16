import { examTypeFilledColor, type ExamCombo } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { examHref } from "../../src/lib/exam-index";
import { useExamCombos } from "../../src/queries/exams";

// `/exams`(설계서 §5 행) — 웹 app/exams/page.tsx 1:1: "← 홈으로" → "시험별 기출문제" →
// 시행처 묶음(국가직 아래 9급·7급·5급이 나란히) → 각 칸에 건수·연도 범위 → 맨 아래
// "과목별 기출문제 →".
//
// 수험생이 실제로 치는 검색어는 "국가직 9급 기출문제"처럼 시행처와 급수를 묶은 말인데
// 과목축(/subjects)만 있던 시절에는 그 제목을 가진 화면이 없었다(웹 page.tsx 머리말).
// 여기서부터 시험 → 연도로 내려가는 축이 시작된다.
//
// 색 표식(examTypeFilledColor)만 두고 배지에 이름을 또 넣지 않는다 — 바로 뒤 제목과
// 같은 말이 두 번 나온다. 급수 배지도 같은 이유로 없다("국가직 9급"이 이미 급수다).

// 같은 시행처의 급수들을 한 덩어리로(웹 groupByExamType). combos 는 이미
// display_order → 건수 순이라 Map 삽입 순서가 그대로 화면 순서다.
function groupByExamType(combos: ExamCombo[]) {
  const groups = new Map<string, ExamCombo[]>();
  for (const combo of combos) {
    const list = groups.get(combo.examTypeName);
    if (list) list.push(combo);
    else groups.set(combo.examTypeName, [combo]);
  }
  return [...groups.entries()].map(([examTypeName, items]) => ({ examTypeName, items }));
}

export default function ExamsIndexScreen() {
  const { query, combos } = useExamCombos();
  const groups = useMemo(() => groupByExamType(combos ?? []), [combos]);

  return (
    <Screen contentClassName="gap-8" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <View className="gap-3">
        <Pressable accessibilityRole="link" onPress={() => router.navigate("/")} hitSlop={6} className="self-start">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 홈으로
          </AppText>
        </Pressable>
        <AppText variant="3xl" weight="bold" accessibilityRole="header">
          시험별 기출문제
        </AppText>
      </View>

      <QueryState query={query} skeleton={<ExamsSkeleton />}>
        {() => (
          <>
            {groups.map((group) => (
              <View key={group.examTypeName} className="gap-3">
                <View className="flex-row items-center gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800">
                  {/* 시행처를 눈으로 구분하는 색 표식. 배지에 이름을 또 넣으면 바로 뒤
                      제목과 같은 말이 두 번 나오므로 색만 남긴다(웹과 동일). */}
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    className={["h-4 w-1.5 rounded-full", examTypeFilledColor(group.examTypeName)].join(" ")}
                  />
                  <AppText variant="lg" weight="semibold" accessibilityRole="header">
                    {group.examTypeName} 기출문제
                  </AppText>
                </View>
                <View className="gap-2">
                  {group.items.map((combo) => (
                    <Pressable
                      key={combo.slug}
                      accessibilityRole="link"
                      onPress={() => router.push(examHref(combo.slug) as Href)}
                      className="gap-1 rounded-lg border border-zinc-200 px-3 py-2.5 active:border-blue-300 active:bg-blue-50 dark:border-zinc-700 dark:active:border-blue-800 dark:active:bg-blue-950/40"
                    >
                      <AppText weight="medium">{combo.label} 기출문제</AppText>
                      <AppText variant="xs" className="text-zinc-400 dark:text-zinc-600">
                        {combo.count.toLocaleString()}건 · {combo.years[combo.years.length - 1]}~{combo.years[0]}년
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            {/* 시험축의 짝인 과목축으로 건너가는 자리(웹 하단 링크와 같은 문구). */}
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
          </>
        )}
      </QueryState>
    </Screen>
  );
}

function ExamsSkeleton() {
  return (
    <View className="gap-8">
      {[0, 1, 2].map((i) => (
        <View key={i} className="gap-3">
          <Skeleton className="h-7 w-40 rounded-lg" delay={i * 100} />
          {[0, 1].map((j) => (
            <Skeleton key={j} className="h-14 w-full rounded-lg" delay={i * 100 + j * 40} />
          ))}
        </View>
      ))}
    </View>
  );
}
