import { Gem, Medal, type LucideIcon } from "lucide-react";

// 회독을 거듭할수록 브론즈 → 실버 → 골드 → 플래티넘 → 다이아로 "승급"하는 느낌을 주는
// 게임식 랭크 배지. 이모지는 기기/폰트마다 모양이 들쭉날쭉해서 대신 벡터 아이콘을 쓴다
// (메달=브론즈~골드, 보석=플래티넘~다이아). 등급이 오를수록 그라데이션도 화려해지고,
// 다이아는 은은한 광택(ring)까지 준다.
export type RoundTier = {
  name: string;
  icon: LucideIcon;
  className: string;
};

const TIERS: { minRound: number; tier: RoundTier }[] = [
  {
    minRound: 10,
    tier: {
      name: "다이아",
      icon: Gem,
      className:
        "bg-gradient-to-br from-sky-300 via-blue-400 to-indigo-500 text-white ring-1 ring-inset ring-white/70 shadow-sm",
    },
  },
  {
    minRound: 6,
    tier: {
      name: "플래티넘",
      icon: Gem,
      className: "bg-gradient-to-br from-teal-200 to-cyan-400 text-teal-900",
    },
  },
  {
    minRound: 4,
    tier: {
      name: "골드",
      icon: Medal,
      className: "bg-gradient-to-br from-yellow-200 to-amber-400 text-amber-900",
    },
  },
  {
    minRound: 2,
    tier: {
      name: "실버",
      icon: Medal,
      className: "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800",
    },
  },
  {
    minRound: 1,
    tier: {
      name: "브론즈",
      icon: Medal,
      className: "bg-gradient-to-br from-orange-200 to-orange-400 text-orange-900",
    },
  },
];

export function getRoundTier(round: number): RoundTier {
  const found = TIERS.find(({ minRound }) => round >= minRound);
  return found ? found.tier : TIERS[TIERS.length - 1].tier;
}
