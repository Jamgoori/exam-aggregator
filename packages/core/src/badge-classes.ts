// 배지 팔레트 — 웹·모바일이 공유하는 Tailwind 클래스 문자열 맵.
//
// 웹은 Tailwind, 앱은 Uniwind 로 같은 className 문자열을 그리므로 "어느 이름이 어떤
// 색인가"를 여기 한 곳에 둔다. 8급·한능검이 한쪽에만 빠져 있던 식의 누락이 재발할
// 구조 자체를 없애기 위한 것. 경계값(몇 회독/며칠이면 어떤 등급인가)은 tiers.ts 의
// roundTierName/streakTierName, 과목 슬롯 해시는 subject-color.ts 가 정한다 — 여기는
// 그 이름에 붙는 클래스 문자열만 안다.
import { roundTierName, streakTierName, type RoundTierName, type StreakTierName } from "./tiers";
import { subjectColorIndex } from "./subject-color";

// ── 급수 배지 ────────────────────────────────────────────────────────────────
export const LEVEL_CLASSES: Record<string, string> = {
  "9급": "bg-blue-600 text-white",
  "8급": "bg-teal-600 text-white",
  "7급": "bg-orange-500 text-white",
  "5급": "bg-purple-600 text-white",
};

export function levelColor(level: string) {
  return LEVEL_CLASSES[level] ?? "bg-zinc-500 text-white";
}

// ── 시험 유형(직렬) 배지 — 맵 넷 ─────────────────────────────────────────────
// 국가직/지방직/지역인재처럼 카드에서 한눈에 구분돼야 하는 직렬 배지 색상.
// 급수(level)·과목(subject) 배지와 헷갈리지 않도록 테두리만 있는 스타일을 쓴다.
export const EXAM_TYPE_OUTLINE_CLASSES: Record<string, string> = {
  국가직: "border border-indigo-300 text-indigo-700",
  지방직: "border border-emerald-300 text-emerald-700",
  지역인재: "border border-pink-300 text-pink-700",
  서울시: "border border-cyan-300 text-cyan-700",
  법원직: "border border-amber-300 text-amber-700",
  경찰: "border border-slate-400 text-slate-700",
  해경: "border border-sky-300 text-sky-700",
  소방: "border border-red-300 text-red-700",
  계리직: "border border-lime-300 text-lime-700",
  기상직: "border border-teal-300 text-teal-700",
  간호직: "border border-fuchsia-300 text-fuchsia-700",
  국회직: "border border-violet-300 text-violet-700",
  한능검: "border border-rose-300 text-rose-700",
};

export function examTypeColor(name: string) {
  return EXAM_TYPE_OUTLINE_CLASSES[name] ?? "border border-zinc-300 text-zinc-700";
}

// 직렬 선택 탭(다중 선택)에서 "선택됨" 상태를 나타낼 때 쓰는, 배경까지 채운 버전.
export const EXAM_TYPE_TAB_CLASSES: Record<string, string> = {
  국가직: "border border-indigo-300 bg-indigo-50 text-indigo-700",
  지방직: "border border-emerald-300 bg-emerald-50 text-emerald-700",
  지역인재: "border border-pink-300 bg-pink-50 text-pink-700",
  서울시: "border border-cyan-300 bg-cyan-50 text-cyan-700",
  법원직: "border border-amber-300 bg-amber-50 text-amber-700",
  경찰: "border border-slate-400 bg-slate-100 text-slate-700",
  해경: "border border-sky-300 bg-sky-50 text-sky-700",
  소방: "border border-red-300 bg-red-50 text-red-700",
  계리직: "border border-lime-300 bg-lime-50 text-lime-700",
  기상직: "border border-teal-300 bg-teal-50 text-teal-700",
  간호직: "border border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700",
  국회직: "border border-violet-300 bg-violet-50 text-violet-700",
  한능검: "border border-rose-300 bg-rose-50 text-rose-700",
};

export function examTypeTabColor(name: string) {
  return EXAM_TYPE_TAB_CLASSES[name] ?? "border border-zinc-400 bg-zinc-100 text-zinc-700";
}

// 시험 카드 배지: 급수(level) 배지처럼 배경을 꽉 채운 스타일. 흰 글자 대비가
// WCAG AA 기준(4.5:1) 이상이 되는 최소 명도 단계로 각 색상 계산해서 골랐다
// (예: emerald-500은 2.54:1로 미달이라 emerald-700=5.48:1을 씀).
export const EXAM_TYPE_FILLED_CLASSES: Record<string, string> = {
  국가직: "bg-indigo-600 text-white", // 6.29:1
  지방직: "bg-emerald-700 text-white", // 5.48:1
  지역인재: "bg-pink-600 text-white", // 4.60:1
  서울시: "bg-cyan-700 text-white", // 5.36:1
  법원직: "bg-amber-700 text-white", // 5.02:1
  경찰: "bg-slate-600 text-white", // 7.58:1
  해경: "bg-sky-700 text-white", // 5.93:1
  소방: "bg-red-600 text-white", // 4.83:1
  계리직: "bg-lime-700 text-white", // 4.99:1
  기상직: "bg-teal-700 text-white", // 5.47:1
  간호직: "bg-fuchsia-600 text-white", // 4.71:1
  국회직: "bg-violet-600 text-white", // 5.70:1
  한능검: "bg-rose-600 text-white", // 4.84:1
};

export function examTypeFilledColor(name: string) {
  return EXAM_TYPE_FILLED_CLASSES[name] ?? "bg-zinc-500 text-white";
}

// /papers 묶음 버튼(exam-browser GROUPS) 전용 — 급수 넷은 levelColor 를 쓰고, 급수가
// 비어 있는 경찰·소방·계리직 셋만 여기서 색을 정한다. filled 맵(경찰 slate-600·계리직
// lime-700)과 값이 다르니 합치지 말 것: 이 셋은 급수 버튼 옆에 나란히 서는 색이다.
export const PAPERS_GROUP_CLASSES: Record<string, string> = {
  경찰: "bg-sky-700 text-white",
  소방: "bg-red-600 text-white",
  계리직: "bg-emerald-600 text-white",
};

export function papersGroupColor(name: string) {
  return PAPERS_GROUP_CLASSES[name];
}

// ── 과목 배지(8슬롯) ─────────────────────────────────────────────────────────
// 어느 슬롯을 쓸지는 subject-color.ts 의 subjectColorIndex — 같은 과목이 웹과 앱에서
// 팔레트의 같은 자리 색을 갖는다.
export const SUBJECT_PALETTE_CLASSES = [
  "bg-blue-100 text-blue-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
  "bg-sky-100 text-sky-700",
];

export function subjectColor(slug: string) {
  // SUBJECT_PALETTE_SIZE 와 길이가 같지만, 한쪽만 늘어나도 깨지지 않게 나머지.
  return SUBJECT_PALETTE_CLASSES[subjectColorIndex(slug) % SUBJECT_PALETTE_CLASSES.length];
}

// ── 회독 등급 배지 ───────────────────────────────────────────────────────────
// 회독을 거듭할수록 브론즈 → 실버 → 골드 → 플래티넘 → 다이아로 "승급"하는 느낌을 주는
// 게임식 랭크 배지. 등급을 아이콘으로 구분하는 대신, 배지 자체가 등급이 오를수록 점점
// 더 반짝이도록 애니메이션 강도만 키운다: shimmer(연속 스윕) → flash(주기적으로 확
// 밝아지는 번쩍임) → glow(은은한 광택 링)까지 상위 등급일수록 더 많이 겹쳐진다.
// 이 세 효과는 전부 같은 duration 하나를 공유해서 한 사이클 안에서 항상 같은 순서
// (sweep → flash → glow)로 겹치지 않게 지나간다 — 웹 globals.css의 keyframe 구간 참고.
export type RoundTier = {
  name: RoundTierName;
  className: string;
  shimmerOpacity: number;
  duration: string;
  hasFlash: boolean;
  hasGlow: boolean;
};

export const ROUND_TIER_STYLES: Record<RoundTierName, Omit<RoundTier, "name">> = {
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
  return { name, ...ROUND_TIER_STYLES[name] };
}

// ── 연속 학습일(스트릭) 등급 배지 ────────────────────────────────────────────
export const STREAK_TIER_CLASSES: Record<StreakTierName, string> = {
  다이아: "bg-cyan-100 text-cyan-700",
  골드: "bg-amber-100 text-amber-700",
  실버: "bg-zinc-200 text-zinc-700",
  브론즈: "bg-orange-100 text-orange-700",
  새싹: "bg-green-100 text-green-700",
};

export function streakTier(days: number) {
  const name = streakTierName(days);
  return name ? { label: name, className: STREAK_TIER_CLASSES[name] } : null;
}
