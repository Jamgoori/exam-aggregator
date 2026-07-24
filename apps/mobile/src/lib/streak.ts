// computeStreakDays 는 @gongmoa/core 로 단일화(웹과 공유). 등급 색은 앱 팔레트.
export { computeStreakDays } from "@gongmoa/core";

const STREAK_TIERS = [
  { min: 30, label: "다이아", color: "#0891b2" },
  { min: 14, label: "골드", color: "#d97706" },
  { min: 7, label: "실버", color: "#71717a" },
  { min: 3, label: "브론즈", color: "#ea580c" },
  { min: 1, label: "새싹", color: "#16a34a" },
] as const;

export function streakTier(days: number) {
  return STREAK_TIERS.find((t) => days >= t.min) ?? null;
}
