// computeStreakDays 는 @gongmoa/core 로 단일화(모바일과 공유). 재노출.
export { computeStreakDays } from "@gongmoa/core";

const STREAK_TIERS = [
  { min: 30, label: "다이아", className: "bg-cyan-100 text-cyan-700" },
  { min: 14, label: "골드", className: "bg-amber-100 text-amber-700" },
  { min: 7, label: "실버", className: "bg-zinc-200 text-zinc-700" },
  { min: 3, label: "브론즈", className: "bg-orange-100 text-orange-700" },
  { min: 1, label: "새싹", className: "bg-green-100 text-green-700" },
] as const;

export function streakTier(days: number) {
  return STREAK_TIERS.find((t) => days >= t.min) ?? null;
}
