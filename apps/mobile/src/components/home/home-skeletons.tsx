import { View } from "react-native";
import { AppText } from "../app-text";
import { Skeleton } from "../skeleton";

// 홈 랜딩의 뼈대(설계서 §4.5 #8) — Suspense 경계 = Query isPending.

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

// 오늘의 학습 현황 카드가 도착하기 전 자리를 잡아 두는 뼈대(웹 TodayStudyCardSkeleton).
// 아래 TodayStudyCard 와 바깥 상자·여백·글자 크기를 그대로 맞춰야 도착하는 순간 화면이
// 밀리지 않는다(빈 칸 높이 = 자리를 대신하는 글자의 줄 높이: text-xs=h-4, text-xl=h-7).
// 제목처럼 누구에게나 같은 글자는 그대로 두고, 사람마다 다른 값만 회색 칸으로 비운다.
export function TodayStudyCardSkeleton() {
  return (
    <View className="w-full max-w-md self-center">
      <View
        className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl shadow-[#012854]/10 dark:border-zinc-800 dark:bg-zinc-950"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View className="mb-5 flex-row items-center justify-between">
          <View>
            <AppText variant="xs" weight="bold" className="text-[#12b382]">
              TODAY&apos;S STUDY
            </AppText>
            <AppText variant="lg" weight="bold" className="mt-1 text-zinc-900 dark:text-zinc-100">
              오늘의 학습 현황
            </AppText>
          </View>
          <Skeleton className="h-10 w-10 rounded-full" />
        </View>

        <View className="flex-row gap-3">
          {[0, 1, 2].map((i) => (
            <View key={i} className="flex-1 rounded-xl bg-[#e7f2fc] p-3 dark:bg-zinc-800/70">
              <Skeleton className="h-4 w-12" delay={i * 60} />
              <Skeleton className="mt-2 h-7 w-14" delay={i * 60} />
            </View>
          ))}
        </View>

        <View className="mt-5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <View className="mb-3 flex-row justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-12" />
          </View>
          <View className="h-24 flex-row gap-2">
            {DAYS.map((d) => (
              <View key={d} className="h-full flex-1 items-center justify-end gap-1">
                <View className="w-full rounded-t bg-zinc-200 dark:bg-zinc-800" style={{ height: "36%" }} />
                <AppText variant="10" className="text-zinc-400">
                  {d}
                </AppText>
              </View>
            ))}
          </View>
        </View>

        <View className="mt-4 flex-row items-center gap-3 rounded-xl bg-[#12b382]/10 p-3">
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <View className="min-w-0 flex-1">
            <Skeleton className="h-4 w-32 max-w-full" />
            <Skeleton className="mt-0.5 h-4 w-44 max-w-full" />
          </View>
        </View>
      </View>
    </View>
  );
}

// 기출문제 찾기 섹션의 시험 카드 6장 자리.
export function ExamComboCardsSkeleton() {
  return (
    <View className="mt-6 gap-3">
      {Array.from({ length: 6 }, (_, i) => (
        <View
          key={i}
          className="flex-row items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
        >
          <Skeleton className="h-11 w-11 shrink-0 rounded-lg" delay={i * 60} />
          <View className="min-w-0 flex-1">
            <Skeleton className="h-5 w-24 rounded" delay={i * 60} />
            <Skeleton className="mt-1 h-4 w-40 max-w-full rounded" delay={i * 60} />
          </View>
        </View>
      ))}
    </View>
  );
}
