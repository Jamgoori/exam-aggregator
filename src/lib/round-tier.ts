// 회독을 거듭할수록 브론즈 → 실버 → 골드 → 플래티넘 → 다이아로 "승급"하는 느낌을 주는
// 게임식 랭크 배지. 아이콘은 Google Noto Emoji(Apache License 2.0)의 메달/보석 이모지를
// public/badges에 정적 이미지로 넣어서 쓴다 — OS 기본 이모지 폰트에 기대면 기기마다
// 모양이 달라지므로, 항상 같은 그림이 보이게 직접 번들링했다.
export type RoundTier = {
  name: string;
  iconSrc: string;
  className: string;
};

const TIERS: { minRound: number; tier: RoundTier }[] = [
  {
    minRound: 10,
    tier: {
      name: "다이아",
      iconSrc: "/badges/diamond.png",
      className:
        "bg-gradient-to-br from-sky-300 via-blue-400 to-indigo-500 text-white ring-1 ring-inset ring-white/70 shadow-sm",
    },
  },
  {
    minRound: 6,
    tier: {
      name: "플래티넘",
      iconSrc: "/badges/platinum.png",
      className: "bg-gradient-to-br from-teal-200 to-cyan-400 text-teal-900",
    },
  },
  {
    minRound: 4,
    tier: {
      name: "골드",
      iconSrc: "/badges/gold.png",
      className: "bg-gradient-to-br from-yellow-200 to-amber-400 text-amber-900",
    },
  },
  {
    minRound: 2,
    tier: {
      name: "실버",
      iconSrc: "/badges/silver.png",
      className: "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800",
    },
  },
  {
    minRound: 1,
    tier: {
      name: "브론즈",
      iconSrc: "/badges/bronze.png",
      className: "bg-gradient-to-br from-orange-200 to-orange-400 text-orange-900",
    },
  },
];

export function getRoundTier(round: number): RoundTier {
  const found = TIERS.find(({ minRound }) => round >= minRound);
  return found ? found.tier : TIERS[TIERS.length - 1].tier;
}
