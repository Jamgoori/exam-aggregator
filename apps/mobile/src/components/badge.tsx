import {
  examTypeColor,
  examTypeFilledColor,
  examTypeTabColor,
  getRoundTier,
  levelColor,
  papersGroupColor,
  streakTier,
  subjectColor,
  type RoundTierName,
} from "@gongmoa/core";
import { LinearGradient } from "expo-linear-gradient";
import { View } from "react-native";
import { AppText } from "./app-text";

// 배지(설계서 §4.5 #3) — 클래스 문자열은 전부 core badge-classes.ts 에서 온다. 웹과 같은 맵,
// 같은 문자열. 8급·한능검 누락이 재발할 구조를 없앤 자리라 여기서 색을 새로 정하지 않는다.
export type BadgeKind =
  | "level"
  | "examTypeFilled"
  | "examTypeOutline"
  | "examTypeTab"
  | "papersGroup"
  | "subject"
  | "status"
  | "micro";

const STATUS_CLASSES: Record<string, string> = {
  correct: "bg-emerald-100 text-emerald-700",
  wrong: "bg-red-100 text-red-700",
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

function kindClass(kind: BadgeKind, value: string): string {
  switch (kind) {
    case "level":
      return levelColor(value);
    case "examTypeFilled":
      return examTypeFilledColor(value);
    case "examTypeOutline":
      return examTypeColor(value);
    case "examTypeTab":
      return examTypeTabColor(value);
    case "papersGroup":
      return papersGroupColor(value) ?? levelColor(value);
    case "subject":
      return subjectColor(value);
    case "status":
      return STATUS_CLASSES[value] ?? STATUS_CLASSES.neutral;
    case "micro":
      return "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";
  }
}

export function Badge({
  kind,
  value,
  label,
  className,
}: {
  kind: BadgeKind;
  // 색을 고르는 키(급수명·시험유형명·과목 slug·상태). label 이 없으면 이 값을 그대로 그린다.
  value: string;
  label?: string;
  className?: string;
}) {
  const micro = kind === "micro";
  return (
    <View className={["self-start rounded px-2 py-0.5", kindClass(kind, value), className ?? ""].join(" ")}>
      <AppText
        variant={micro ? "10" : "11"}
        weight="semibold"
        allowFontScaling={false}
        className={kindClass(kind, value)}
      >
        {label ?? value}
      </AppText>
    </View>
  );
}

// 회독 등급 배지. 웹은 CSS 그라데이션 + shimmer/flash/glow 애니메이션 — 앱은 우선
// LinearGradient 로 그라데이션만 그린다(Skia shimmer 는 후속). 색은 core 클래스 문자열의
// from/to 를 hex 로 옮긴 것(Tailwind v4 값).
const TIER_GRADIENT: Record<RoundTierName, { colors: readonly [string, string, ...string[]]; text: string }> = {
  다이아: { colors: ["#53eafd", "#ed6bff", "#615fff"], text: "text-white" },
  플래티넘: { colors: ["#96f7e4", "#00d3f2"], text: "text-teal-900" },
  골드: { colors: ["#ffef9d", "#ffb900"], text: "text-amber-900" },
  실버: { colors: ["#e2e8f0", "#90a1b9"], text: "text-slate-800" },
  브론즈: { colors: ["#ffd6a7", "#ff8904"], text: "text-orange-900" },
};

export function TierBadge({ round, className }: { round: number; className?: string }) {
  const tier = getRoundTier(round);
  const g = TIER_GRADIENT[tier.name];
  return (
    <LinearGradient
      colors={g.colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      className={["self-start rounded-full px-2 py-0.5", className ?? ""].join(" ")}
      accessibilityLabel={`${tier.name} (${round}회독)`}
    >
      <AppText variant="xs" weight="bold" allowFontScaling={false} className={g.text}>
        {tier.name} ({round}회독)
      </AppText>
    </LinearGradient>
  );
}

// 연속 학습일 등급 필(틴트 채움).
export function StreakPill({ days, className }: { days: number; className?: string }) {
  const tier = streakTier(days);
  if (!tier) return null;
  return (
    <View className={["self-start rounded-full px-2 py-0.5", tier.className, className ?? ""].join(" ")}>
      <AppText variant="11" weight="semibold" allowFontScaling={false} className={tier.className}>
        {tier.label} · {days}일
      </AppText>
    </View>
  );
}

// 알림 종 옆 미읽음 수(h-4 min-w-4 bg-red-500 ring-2).
export function UnreadCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <View className="h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 border-2 border-white dark:border-zinc-950">
      <AppText variant="10" weight="bold" allowFontScaling={false} className="text-white" tabular>
        {count > 99 ? "99+" : String(count)}
      </AppText>
    </View>
  );
}
