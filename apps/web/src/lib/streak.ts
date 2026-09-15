// computeStreakDays·등급 판정(streakTierName)·등급별 색(streakTier)은 @gongmoa/core 로
// 단일화(모바일과 공유 — core/badge-classes.ts). 이 파일은 기존 import 경로를 지키는
// re-export 뿐.
export { computeStreakDays, streakTier, STREAK_TIER_CLASSES } from "@gongmoa/core";
