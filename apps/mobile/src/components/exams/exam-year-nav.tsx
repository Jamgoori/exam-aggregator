import type { ExamCombo } from "@gongmoa/core";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";

// 연도 고르는 줄(웹 exams/exam-page-parts.tsx ExamYearNav). 지금 보고 있는 연도는 눌러도
// 제자리라 웹에서는 링크 대신 표시만 한다 — 앱도 같은 모양으로 두고 누름만 막는다.
// 웹의 rel="nofollow"(크롤러가 연도 줄을 훑어 대체 페이지를 쌓지 않게)는 앱에 대응이 없다.
export function ExamYearNav({
  combo,
  activeYear,
  onChange,
}: {
  combo: ExamCombo;
  activeYear?: number;
  onChange: (year: number) => void;
}) {
  if (combo.yearCounts.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-2">
      {combo.yearCounts.map(({ year, count }) => {
        const active = year === activeYear;
        return (
          <Pressable
            key={year}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled: active }}
            disabled={active}
            onPress={() => onChange(year)}
            className={[
              "rounded-full px-4 py-1.5",
              active
                ? "bg-zinc-800 dark:bg-zinc-200"
                : "border border-zinc-200 active:border-blue-300 active:bg-blue-50 dark:border-zinc-700 dark:active:border-blue-800 dark:active:bg-blue-950/40",
            ].join(" ")}
          >
            <AppText
              variant="sm"
              weight="medium"
              className={active ? "text-white dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-400"}
            >
              {year}년 {count}건
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
