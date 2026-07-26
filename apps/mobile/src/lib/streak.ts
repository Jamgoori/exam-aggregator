// computeStreakDays·등급 판정(streakTierName)은 @gongmoa/core 로 단일화(웹과 공유).
// 등급별 색만 앱 팔레트(hex)라 여기 남긴다.
import { streakTierName, type StreakTierName } from "@gongmoa/core";

export { computeStreakDays } from "@gongmoa/core";

const TIER_COLOR: Record<StreakTierName, string> = {
  다이아: "#0891b2",
  골드: "#d97706",
  실버: "#71717a",
  브론즈: "#ea580c",
  새싹: "#16a34a",
};

export function streakTier(days: number) {
  const name = streakTierName(days);
  return name ? { label: name, color: TIER_COLOR[name] } : null;
}
