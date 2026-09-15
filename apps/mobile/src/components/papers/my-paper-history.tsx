import { KST_TIME_ZONE, type MyCbtRecordItem, type RoundAverage } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ChevronRight, Trophy } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

export type { MyCbtRecordItem, RoundAverage };

// 이 정도까지는 펼쳐두고, 그보다 오래된 회독은 접는다(웹 <details> → 접기 토글, 설계서 §4.5 #21).
const INLINE_LIMIT = 4;

const ChevronIcon = themedIcon(ChevronRight);

/**
 * 문제지 상세의 "내 시험 기록"(웹 my-paper-history.tsx) — 이 시험지를 언제 풀어서 몇 점을
 * 받았는지 회독 순서대로. 기록이 없는 사람(비회원 포함)에게는 아무것도 그리지 않는다.
 */
export function MyPaperHistory({ attempts, roundAverages }: { attempts: MyCbtRecordItem[]; roundAverages: RoundAverage[] }) {
  const [open, setOpen] = useState(false);
  if (attempts.length === 0) return null;

  const averageByRound = new Map(roundAverages.map((r) => [r.round, r]));
  // 들어올 때는 오래된 순(1회독부터). 화면에는 최신 회독을 맨 위에.
  const rows = attempts
    .map((a) => ({ ...a, pct: a.totalQuestions > 0 ? Math.round((a.score / a.totalQuestions) * 100) : 0 }))
    .reverse();
  const latest = rows[0];
  const previous = rows[1];
  const bestPct = Math.max(...rows.map((r) => r.pct));
  const gain = previous ? latest.pct - previous.pct : null;
  const recent = rows.slice(0, INLINE_LIMIT);
  const older = rows.slice(INLINE_LIMIT);

  return (
    <View className="gap-1 rounded-xl border border-zinc-200 px-3.5 py-3 dark:border-zinc-700">
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <View className="flex-row items-center gap-1.5">
          <Trophy size={14} color="#fd9a00" />
          <AppText variant="sm" weight="bold" className="text-zinc-700 dark:text-zinc-300">
            내 시험 기록{" "}
            <AppText variant="sm" weight="medium" className="text-zinc-400 dark:text-zinc-500">
              {rows.length}회 응시
            </AppText>
          </AppText>
        </View>
        <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
          최고{" "}
          <AppText variant="xs" weight="bold" className="text-zinc-700 dark:text-zinc-300">
            {bestPct}점
          </AppText>
          {gain !== null && (
            <>
              {" · 지난 회독보다 "}
              {/* 오르내림은 위치를 알려주는 값이라 내려갔을 때도 오답 색(빨강)을 쓰지 않는다. */}
              <AppText
                variant="xs"
                weight="bold"
                className={gain > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}
              >
                {gain > 0 ? `+${gain}` : gain === 0 ? "±0" : gain}점
              </AppText>
            </>
          )}
        </AppText>
      </View>

      <View>
        {recent.map((row) => (
          <AttemptRow key={row.id} row={row} average={averageByRound.get(row.round) ?? null} />
        ))}
      </View>

      {older.length > 0 && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            onPress={() => setOpen((v) => !v)}
            className="px-2 py-1.5"
          >
            <AppText variant="xs" weight="medium" className="text-zinc-500 dark:text-zinc-500">
              이전 기록 {older.length}개 더보기{open ? " ▴" : " ▾"}
            </AppText>
          </Pressable>
          {open && (
            <View>
              {older.map((row) => (
                <AttemptRow key={row.id} row={row} average={averageByRound.get(row.round) ?? null} />
              ))}
            </View>
          )}
        </>
      )}

      <AppText variant="11" className="px-2 pt-1 text-zinc-400 dark:text-zinc-600">
        회독을 누르면 그때 틀린 문제만 모아 볼 수 있어요
      </AppText>
    </View>
  );
}

// 회독 한 줄. 누르면 그 회차의 오답만 모아둔 페이지로 간다. 소요 시간·평균 대비 배지는 웹에서
// `hidden sm:inline`(폰 폭에서 숨김)이라 앱도 그리지 않는다.
function AttemptRow({ row }: { row: MyCbtRecordItem & { pct: number }; average: RoundAverage | null }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(`/mypage/attempts/${row.id}` as Href)}
      className="flex-row items-center gap-2 rounded-lg px-2 py-2 active:bg-zinc-50 dark:active:bg-zinc-800/50"
    >
      <View className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
        <AppText variant="xs" weight="semibold" allowFontScaling={false} className="text-zinc-600 dark:text-zinc-400">
          {row.round}회독
        </AppText>
      </View>
      <AppText variant="xs" numberOfLines={1} className="min-w-0 shrink text-zinc-400 dark:text-zinc-600">
        {new Date(row.createdAt).toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE })}
      </AppText>
      <View className="ml-auto shrink-0 flex-row items-baseline gap-1.5">
        <AppText weight="bold" tabular className="text-zinc-900 dark:text-zinc-100">
          {row.pct}점
        </AppText>
        <AppText variant="xs" tabular className="text-zinc-400 dark:text-zinc-600">
          {row.score}/{row.totalQuestions}
        </AppText>
      </View>
      <ChevronIcon size={15} colorClassName="text-zinc-300 dark:text-zinc-700" />
    </Pressable>
  );
}
