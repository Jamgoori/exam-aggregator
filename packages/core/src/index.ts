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
export * from "./chat";
export * from "./suggestions";
export * from "./notices";
export * from "./board";
export * from "./rich-text";
export * from "./notifications";
export * from "./avatar";
export * from "./nickname";
export * from "./profanity";
export * from "./search";
export * from "./streak";
export * from "./attendance";
export * from "./paper-title";
export * from "./subject-label";
export * from "./paper-slug";
export * from "./levels";
export * from "./exam-level-tier";
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
export * from "./mix-practice";
export * from "./concept-key";
export * from "./concept-dictionary";
export * from "./review-resume";
export * from "./study-phase";

// 오답노트 집계 (표시는 각 앱, 판정 규칙은 여기 하나)
export * from "./wrong-notes";
// 문항 해설 화면 타입 — 웹 컴포넌트(explanation-body)·앱 해설 카드가 같은 모양을 그린다.
// 정규화 함수 본문은 서버 진입점(server.ts → rules/explanations)에 있고 여기는 타입만.
export type { NormalizedChoiceExplanation, QuestionExplanationContent } from "./rules/explanations";

// 데이터 접근 (DI — SupabaseClient 주입)
export * from "./data/subjects";

// 웹·앱이 같은 문자열을 그리는 표시 데이터 (배지 클래스 맵·메뉴 항목·진단 진행률)
export * from "./badge-classes";
export * from "./nav-items";
export * from "./diagnosis-progress";

// CBT 최소 응시시간·답안 정제 — 클라이언트(솔버)와 서버 규칙이 같은 값을 쓴다
export * from "./cbt-attempt";
