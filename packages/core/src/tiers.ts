// 등급 판정 — 웹·모바일 공유(순수 계산). 색·애니메이션 같은 표현은 플랫폼마다 달라서
// (웹은 Tailwind 클래스 문자열, 앱은 hex/StyleSheet) 여기에 두지 않는다. 여기가 정하는
// 것은 "며칠/몇 회독이면 어떤 등급인가" 하나뿐이고, 각 앱은 등급 이름으로 자기 스타일
// 테이블을 찾아 쓴다.

// ── 연속 학습일(스트릭) 등급 ─────────────────────────────────────────────────
// 웹 src/lib/streak.ts 와 모바일 src/lib/streak.ts 에 같은 경계값이 두 벌로 있었다.
export type StreakTierName = "다이아" | "골드" | "실버" | "브론즈" | "새싹";

const STREAK_TIERS: { min: number; name: StreakTierName }[] = [
  { min: 30, name: "다이아" },
  { min: 14, name: "골드" },
  { min: 7, name: "실버" },
  { min: 3, name: "브론즈" },
  { min: 1, name: "새싹" },
];

// 연속 학습일이 0이면 등급 없음(null).
export function streakTierName(days: number): StreakTierName | null {
  return STREAK_TIERS.find((t) => days >= t.min)?.name ?? null;
}

// ── 회독 등급 ────────────────────────────────────────────────────────────────
// 회독을 거듭할수록 브론즈 → 실버 → 골드 → 플래티넘 → 다이아로 "승급"한다.
// 스트릭과 달리 0회독도 최하위 등급으로 떨어뜨려 항상 등급이 나온다(웹 getRoundTier
// 가 fallback 으로 브론즈를 돌려주던 동작 그대로).
export type RoundTierName = "다이아" | "플래티넘" | "골드" | "실버" | "브론즈";

const ROUND_TIERS: { minRound: number; name: RoundTierName }[] = [
  { minRound: 10, name: "다이아" },
  { minRound: 6, name: "플래티넘" },
  { minRound: 4, name: "골드" },
  { minRound: 2, name: "실버" },
  { minRound: 1, name: "브론즈" },
];

export function roundTierName(round: number): RoundTierName {
  return ROUND_TIERS.find((t) => round >= t.minRound)?.name ?? "브론즈";
}
