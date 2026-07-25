// 회독을 거듭할수록 브론즈 → 실버 → 골드 → 플래티넘 → 다이아로 "승급"하는 느낌을 주는
// 게임식 랭크 배지. 등급을 아이콘으로 구분하는 대신, 배지 자체가 등급이 오를수록 점점
// 더 반짝이도록 애니메이션 강도만 키운다: shimmer(연속 스윕) → flash(주기적으로 확
// 밝아지는 번쩍임) → glow(은은한 광택 링)까지 상위 등급일수록 더 많이 겹쳐진다.
// 이 세 효과는 전부 같은 duration 하나를 공유해서 한 사이클 안에서 항상 같은 순서
// (sweep → flash → glow)로 겹치지 않게 지나간다 — globals.css의 keyframe 구간 참고.
//
// 등급 경계(몇 회독이면 무슨 등급인지)는 @gongmoa/core 의 roundTierName 으로 단일화했다
// — 모바일 회독 배지도 같은 판정을 쓰기 위한 것. 아래 표는 등급 이름에 붙는 웹 전용
// 스타일(Tailwind 클래스·애니메이션 강도)이다.
import { roundTierName, type RoundTierName } from "@gongmoa/core";

export type RoundTier = {
  name: RoundTierName;
  className: string;
  shimmerOpacity: number;
  duration: string;
  hasFlash: boolean;
  hasGlow: boolean;
};

const TIER_STYLES: Record<RoundTierName, Omit<RoundTier, "name">> = {
  다이아: {
    // 홀로그램처럼 색이 도는 느낌을 주려고 차갑고 화려한 톤(시안→마젠타→인디고)을
    // 섞고, 링을 두껍게+상시 컬러 글로우(shadow)까지 얹어서 최상위 등급다운
    // 존재감을 준다. 주기적 흰색 pulse(badge-glow)는 이 상시 글로우 위에 겹친다.
    className:
      "bg-gradient-to-br from-cyan-300 via-fuchsia-400 to-indigo-500 text-white ring-2 ring-inset ring-white/80 shadow-[0_0_10px_1px_rgba(217,70,239,0.5)]",
    shimmerOpacity: 0.9,
    duration: "2.4s",
    hasFlash: true,
    hasGlow: true,
  },
  플래티넘: {
    className: "bg-gradient-to-br from-teal-200 to-cyan-400 text-teal-900",
    shimmerOpacity: 0.65,
    duration: "2.8s",
    hasFlash: true,
    hasGlow: true,
  },
  골드: {
    className: "bg-gradient-to-br from-yellow-200 to-amber-400 text-amber-900",
    shimmerOpacity: 0.45,
    duration: "3.2s",
    hasFlash: true,
    hasGlow: false,
  },
  실버: {
    className: "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-800",
    shimmerOpacity: 0.25,
    duration: "3.2s",
    hasFlash: false,
    hasGlow: false,
  },
  브론즈: {
    className: "bg-gradient-to-br from-orange-200 to-orange-400 text-orange-900",
    shimmerOpacity: 0,
    duration: "3.5s",
    hasFlash: false,
    hasGlow: false,
  },
};

export function getRoundTier(round: number): RoundTier {
  const name = roundTierName(round);
  return { name, ...TIER_STYLES[name] };
}
