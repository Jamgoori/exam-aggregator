import { ROUND_AVERAGE_MIN_SAMPLE, type PaperRoundComparison } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Lock, Users } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 회독별 "나 vs 다른 회원 평균"(웹 round-average-compare.tsx, 설계서 §8.3 회독별 타인 평균):
// 무료는 잠금 링크(→ /membership?next=), 프리미엄은 비교 표. 데이터는 queries/papers.ts
// usePaperRoundComparisons(RPC paper_round_score_stats — authenticated 전용이라 로그인 시에만).
const LockIcon = themedIcon(Lock);
const UsersIcon = themedIcon(Users);

export function RoundAverageCompare({
  comparisons,
  premium,
  // 결제 페이지에서 돌아올 곳.
  next,
  // 지금 보고 있는 회독(전체 보기면 null). 그 줄을 강조한다.
  selectedRound,
}: {
  comparisons: PaperRoundComparison[];
  premium: boolean;
  next: string;
  selectedRound: number | null;
}) {
  if (!premium) {
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push(`/membership?next=${encodeURIComponent(next)}` as Href)}
        className="flex-row items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 active:border-blue-300 active:bg-blue-50/50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:active:border-blue-800 dark:active:bg-blue-950/20"
      >
        <LockIcon size={14} colorClassName="text-zinc-400 dark:text-zinc-500" />
        <AppText variant="xs" className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-400" pretty>
          <AppText variant="xs" weight="bold" className="text-zinc-700 dark:text-zinc-300">
            다른 회원들의 회독별 평균 점수
          </AppText>
          <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
            {" "}· 같은 시험지를 같은 회독만큼 푼 사람들과 내 점수를 비교해요
          </AppText>
        </AppText>
        <AppText variant="xs" weight="bold" className="shrink-0 text-blue-600 dark:text-blue-400">
          멤버십 ›
        </AppText>
      </Pressable>
    );
  }

  if (comparisons.length === 0) return null;
  const hasAnyAverage = comparisons.some((c) => c.othersAvgPct !== null);

  return (
    <View className="gap-2 rounded-xl border border-zinc-200 px-3.5 py-3 dark:border-zinc-700">
      <View className="flex-row items-center gap-1.5">
        <UsersIcon size={13} colorClassName="text-blue-600 dark:text-blue-400" />
        <AppText variant="xs" weight="bold" className="text-zinc-700 dark:text-zinc-300">
          회독별 점수 비교{" "}
          <AppText variant="xs" weight="medium" className="text-zinc-400 dark:text-zinc-500">
            (나 · 다른 회원 평균)
          </AppText>
        </AppText>
      </View>

      {hasAnyAverage ? (
        <View className="gap-1.5">
          {comparisons.map((c) => (
            <CompareRow key={c.round} row={c} highlighted={selectedRound === c.round} />
          ))}
        </View>
      ) : (
        <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500" pretty>
          아직 이 시험지를 이만큼 푼 회원이 적어서 평균을 낼 수 없어요 (회독당 최소 {ROUND_AVERAGE_MIN_SAMPLE}명 필요).
        </AppText>
      )}
    </View>
  );
}

function CompareRow({ row, highlighted }: { row: PaperRoundComparison; highlighted: boolean }) {
  const diff = row.othersAvgPct === null ? null : row.myPct - row.othersAvgPct;
  return (
    <View
      className={[
        "flex-row flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5",
        highlighted ? "bg-blue-50 dark:bg-blue-950/30" : "",
      ].join(" ")}
    >
      <AppText variant="xs" weight="semibold" className="w-12 shrink-0 text-zinc-600 dark:text-zinc-400">
        {row.round}회독
      </AppText>
      <AppText variant="xs" className="shrink-0 text-zinc-500 dark:text-zinc-500">
        나{" "}
        <AppText variant="xs" weight="bold" className="text-zinc-800 dark:text-zinc-200">
          {row.myPct}점
        </AppText>
      </AppText>
      {diff === null ? (
        <AppText variant="xs" className="text-zinc-400 dark:text-zinc-600">
          다른 회원 {row.othersCount}명 · 평균을 내기엔 표본이 적어요
        </AppText>
      ) : (
        <>
          <AppText variant="xs" className="shrink-0 text-zinc-500 dark:text-zinc-500">
            평균{" "}
            <AppText variant="xs" weight="bold" className="text-zinc-700 dark:text-zinc-300">
              {row.othersAvgPct}점
            </AppText>
          </AppText>
          {/* 차이는 위치를 알려주는 값이라 낮을 때도 빨강(오답 색)을 쓰지 않는다. */}
          <View
            className={[
              "shrink-0 rounded-full px-1.5 py-0.5",
              diff > 0
                ? "bg-emerald-100 dark:bg-emerald-950/30"
                : "bg-zinc-100 dark:bg-zinc-800",
            ].join(" ")}
          >
            <AppText
              variant="xs"
              weight="bold"
              allowFontScaling={false}
              className={
                diff > 0
                  ? "text-emerald-700 dark:text-emerald-400"
                  : diff < 0
                    ? "text-zinc-600 dark:text-zinc-400"
                    : "text-zinc-500 dark:text-zinc-500"
              }
            >
              {diff > 0 ? `+${diff}` : diff === 0 ? "±0" : diff}
            </AppText>
          </View>
          <AppText variant="xs" className="shrink-0 text-zinc-400 dark:text-zinc-600">
            ({row.othersCount}명)
          </AppText>
        </>
      )}
    </View>
  );
}
