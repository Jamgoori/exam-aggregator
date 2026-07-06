// 회독을 거듭할수록 브론즈 → 실버 → 골드 → 플래티넘 → 다이아로 "승급"하는 느낌을 주는
// 게임식 랭크 배지. 등급을 아이콘으로 구분하는 대신, 배지 자체가 등급이 오를수록 점점
// 더 반짝이도록(shimmer 스윕 + 상위 등급은 은은한 glow) 애니메이션 강도만 키운다.
export type RoundTier = {
  name: string;
  className: string;
  shimmerOpacity: number;
  shimmerDuration: string;
  glowDuration: string | null;
};

const TIERS: { minRound: number; tier: RoundTier }[] = [
  {
    minRound: 10,
    tier: {
      name: "다이아",
      className:
        "bg-gradient-to-br from-sky-300 via-blue-400 to-indigo-500 text-white ring-1 ring-inset ring-white/70 shadow-sm",
      shimmerOpacity: 0.9,
      shimmerDuration: "1.2s",
      glowDuration: "1.4s",
    },
  },
  {
    minRound: 6,
    tier: {
      name: "플래티넘",
      className: "bg-gradient-to-br from-teal-200 to-cyan-400 text-teal-900",
      shimmerOpacity: 0.65,
      shimmerDuration: "1.8s",
      glowDuration: "2.2s",
    },
  },
  {
    minRound: 4,
    tier: {
      name: "골드",
      className: "bg-gradient-to-br from-yellow-200 to-amber-400 text-amber-900",
      shimmerOpacity: 0.45,
      shimmerDuration: "2.4s",
      glowDuration: null,
    },
  },
  {
    minRound: 2,
    tier: {
      name: "실버",
      className: "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800",
      shimmerOpacity: 0.25,
      shimmerDuration: "3.2s",
      glowDuration: null,
    },
  },
  {
    minRound: 1,
    tier: {
      name: "브론즈",
      className: "bg-gradient-to-br from-orange-200 to-orange-400 text-orange-900",
      shimmerOpacity: 0,
      shimmerDuration: "3.5s",
      glowDuration: null,
    },
  },
];

export function getRoundTier(round: number): RoundTier {
  const found = TIERS.find(({ minRound }) => round >= minRound);
  return found ? found.tier : TIERS[TIERS.length - 1].tier;
}
