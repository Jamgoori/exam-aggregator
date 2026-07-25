import { roundTierName, type RoundTierName } from "@gongmoa/core";

// 회독 배지. 등급 경계는 @gongmoa/core 로 웹과 공유하고(roundTierName), 웹이 Tailwind
// 그라디언트로 그리는 자리를 앱은 단색 배지로 대체한다.
const TIER_COLOR: Record<RoundTierName, { bg: string; fg: string }> = {
  다이아: { bg: "#7c3aed", fg: "#ffffff" },
  플래티넘: { bg: "#0e7490", fg: "#ffffff" },
  골드: { bg: "#b45309", fg: "#ffffff" },
  실버: { bg: "#e4e4e7", fg: "#3f3f46" },
  브론즈: { bg: "#fed7aa", fg: "#9a3412" },
};

export function roundBadge(round: number) {
  const name = roundTierName(round);
  return { name, ...TIER_COLOR[name] };
}
