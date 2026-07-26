// computeStreakDays·등급 판정(streakTierName)은 @gongmoa/core 로 단일화(모바일과 공유).
// 등급별 색만 Tailwind 클래스라 여기 남긴다.
import { streakTierName, type StreakTierName } from "@gongmoa/core";

export { computeStreakDays } from "@gongmoa/core";

const TIER_CLASS: Record<StreakTierName, string> = {
  다이아: "bg-cyan-100 text-cyan-700",
  골드: "bg-amber-100 text-amber-700",
  실버: "bg-zinc-200 text-zinc-700",
  브론즈: "bg-orange-100 text-orange-700",
  새싹: "bg-green-100 text-green-700",
};

export function streakTier(days: number) {
  const name = streakTierName(days);
  return name ? { label: name, className: TIER_CLASS[name] } : null;
}
