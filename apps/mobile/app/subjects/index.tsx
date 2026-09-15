import { CONSONANTS, initialConsonant, type ExamCombo, type SubjectIndexEntry } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { useSubjectIndex } from "../../src/queries/catalog";
import { useHomeLanding } from "../../src/queries/home";

// `/subjects`(설계서 §5 행) — 웹 app/subjects/page.tsx 1:1: "← 홈으로" → "과목별 기출문제" → ㄱㄴㄷ
// 묶음 목록(묶음 안 가나다순, 영문·숫자 시작은 맨 뒤 "기타") → "시험으로 찾기" 콤보 칩(시행처+급수,
// exam-index combos) + 전체보기 링크. 웹에 없는 초성 탭 스트립·즐겨찾는 과목 섹션은 두지 않는다.
// 콤보 칩은 /exams/[slug] 가 Phase 2 까지 없어 홈 시험 카드처럼 같은 필터의 /papers 로 보낸다.

function comboPapersHref(c: ExamCombo): Href {
  const params: Record<string, string> = { type: c.examTypeName };
  if (c.level) params.level = c.level;
  return { pathname: "/papers", params } as Href;
}

// ㄱㄴㄷ 묶음 안에서는 가나다순, 묶음 자체는 CONSONANTS 순서를 그대로 따른다.
function groupByConsonant(entries: SubjectIndexEntry[]) {
  const groups = new Map<string, SubjectIndexEntry[]>();
  for (const entry of entries) {
    const key = initialConsonant(entry.name);
    const bucket = key && (CONSONANTS as readonly string[]).includes(key) ? key : "기타";
    const list = groups.get(bucket);
    if (list) list.push(entry);
    else groups.set(bucket, [entry]);
  }
  const order = [...CONSONANTS, "기타"];
  return order.flatMap((key) => {
    const list = groups.get(key);
    if (!list || list.length === 0) return [];
    return [{ key, items: [...list].sort((a, b) => a.name.localeCompare(b.name, "ko")) }];
  });
}

function yearRange(entry: SubjectIndexEntry) {
  return entry.minYear === entry.maxYear ? `${entry.maxYear}년` : `${entry.minYear}~${entry.maxYear}년`;
}

export default function SubjectsIndexScreen() {
  const { query, data } = useSubjectIndex();
  const landing = useHomeLanding();
  const groups = useMemo(() => (data ? groupByConsonant(data.entries) : []), [data]);

  return (
    <Screen contentClassName="gap-8" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <View className="gap-3">
        <Pressable accessibilityRole="link" onPress={() => router.navigate("/")} hitSlop={6} className="self-start">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 홈으로
          </AppText>
        </Pressable>
        <AppText variant="3xl" weight="bold">
          과목별 기출문제
        </AppText>
      </View>

      <QueryState query={query} skeleton={<SubjectsSkeleton />}>
        {() => (
          <>
            {groups.map((group) => (
              <View key={group.key} className="gap-3">
                <View className="flex-row items-center gap-2 border-b border-zinc-100 pb-2 dark:border-zinc-800">
                  <View className="h-7 w-7 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40">
                    <AppText variant="sm" allowFontScaling={false} className="text-blue-600 dark:text-blue-400">
                      {group.key}
                    </AppText>
                  </View>
                  <AppText variant="sm" className="text-zinc-400 dark:text-zinc-600">
                    {group.items.length}과목
                  </AppText>
                </View>
                <View className="gap-2">
                  {group.items.map((entry) => (
                    <Pressable
                      key={entry.slug}
                      accessibilityRole="link"
                      onPress={() => router.push(`/subjects/${entry.slug}` as Href)}
                      className="flex-row items-baseline justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2.5 active:border-blue-300 active:bg-blue-50 dark:border-zinc-700 dark:active:border-blue-800 dark:active:bg-blue-950/40"
                    >
                      <AppText weight="medium" className="min-w-0 flex-1">
                        {entry.name}
                      </AppText>
                      <AppText variant="xs" className="shrink-0 text-zinc-400 dark:text-zinc-600">
                        {entry.count.toLocaleString()}건 · {yearRange(entry)}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}

            {/* 과목축의 짝인 시험축(시행처+급수)으로 건너가는 자리. */}
            <View className="gap-3 border-t border-zinc-100 pt-6 dark:border-zinc-800">
              <AppText variant="lg" weight="semibold">
                시험으로 찾기
              </AppText>
              <View className="flex-row flex-wrap gap-2">
                {(landing.data?.combos ?? []).map((combo) => (
                  <Pressable
                    key={combo.slug}
                    accessibilityRole="link"
                    onPress={() => router.push(comboPapersHref(combo))}
                    className="rounded-full border border-zinc-200 px-4 py-1.5 active:border-blue-300 active:bg-blue-50 dark:border-zinc-700 dark:active:border-blue-800 dark:active:bg-blue-950/40"
                  >
                    <AppText variant="sm" weight="medium" className="text-zinc-600 dark:text-zinc-400">
                      {combo.label} 기출문제
                    </AppText>
                  </Pressable>
                ))}
              </View>
              <Pressable accessibilityRole="link" onPress={() => router.push("/exams" as Href)} hitSlop={6} className="self-start">
                <AppText variant="sm" weight="medium" className="text-blue-600 dark:text-blue-400">
                  시험별 기출문제 전체보기 →
                </AppText>
              </Pressable>
            </View>
          </>
        )}
      </QueryState>
    </Screen>
  );
}

function SubjectsSkeleton() {
  return (
    <View className="gap-8">
      {[0, 1, 2].map((i) => (
        <View key={i} className="gap-3">
          <Skeleton className="h-7 w-24 rounded-lg" delay={i * 100} />
          {[0, 1, 2].map((j) => (
            <Skeleton key={j} className="h-11 w-full rounded-lg" delay={i * 100 + j * 40} />
          ))}
        </View>
      ))}
    </View>
  );
}
