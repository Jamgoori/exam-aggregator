// 회독 등급 경계(roundTierName)와 등급별 스타일(getRoundTier — 그라데이션·shimmer 강도)
// 은 @gongmoa/core 로 단일화(모바일과 공유 — core/badge-classes.ts). 이 파일은 기존
// import 경로를 지키는 re-export 뿐.
export { getRoundTier, ROUND_TIER_STYLES, type RoundTier } from "@gongmoa/core";
