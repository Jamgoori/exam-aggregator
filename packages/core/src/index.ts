// @gongmoa/core — 웹(apps/web)과 모바일(apps/mobile)이 공유하는 플랫폼 비의존 코어.
//
// 설계 원칙: 이 패키지는 특정 Supabase 클라이언트(웹 @supabase/ssr / 모바일 토큰)에
// 의존하지 않는다. 데이터 접근 함수는 SupabaseClient 를 인자로 주입(DI)받는다.
//
// 로드맵:
//   Phase 1 — 순수 로직(hangul, format, colors, 검증 규칙 등) + 타입 단일화  ← 진행 중
//   Phase 2 — DI 데이터 접근(subjects, papers, search, mypage, review, diagnosis ...)

// 도메인 타입 (웹·모바일 공유 — Supabase 스키마 대응)
export * from "./types";

// 순수 로직 (플랫폼/클라이언트 비의존)
export * from "./hangul";
export * from "./format";
export * from "./comment-constraints";
export * from "./comments";
export * from "./nickname";
export * from "./search";
export * from "./streak";
export * from "./paper-title";
export * from "./paper-slug";
export * from "./levels";
export * from "./tiers";
export * from "./subject-color";
export * from "./dedup-papers";
export * from "./srs";
export * from "./srs-retention";
export * from "./membership";
export * from "./pricing";
export * from "./payment";
export * from "./review-queue";
export * from "./review-pick";
export * from "./concept-key";
export * from "./concept-dictionary";
export * from "./review-resume";
export * from "./study-phase";

// 오답노트 집계 (표시는 각 앱, 판정 규칙은 여기 하나)
export * from "./wrong-notes";

// 데이터 접근 (DI — SupabaseClient 주입)
export * from "./data/subjects";
