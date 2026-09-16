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

// Edge Function 계약(요청/응답 타입)과 호출기 — 앱(apps/mobile)이 Edge 를 부르는 유일한 경로.
// contracts.ts 는 rules/* 를 `import type` 으로만 참조해 service_role 규칙 본문이 앱 번들에
// 섞이지 않는다(server.ts 가 아니라 여기서 내보내는 이유). 응답은 추가만(add-only).
export * from "./edge/contracts";
export * from "./edge/invoke";

// 로그인 후 복귀 경로 검증 — 웹 auth 콜백·앱 /login 모달이 같은 규칙으로 next 를 거른다.
export * from "./safe-redirect";

// 세트문제 묶기 — 웹 cbt-solver questionGroups·오답노트 groupRowsBySharedImages 와 앱이 같은 규칙.
export * from "./question-groups";
// CBT 시작 모드 판정(웹 lib/cbt-view-mode.ts 는 re-export).
export * from "./cbt-view-mode";
// 문항 이미지 미리받기 큐(웹 lib/image-preload-queue.ts 는 re-export).
export * from "./image-preload-queue";
// CBT 응시 복원(DI) — 앱 타임아웃·이중 제출 복구(설계서 §6.6).
export * from "./data/cbt";

// 카탈로그·문제지 상세·즐겨찾기·댓글·슬러그 역색인 (DI — 모바일 Phase 1a 카탈로그 스트림)
export * from "./data/papers";
export * from "./data/paper-detail";
export * from "./data/bookmarks";
export * from "./data/comments";
export * from "./data/paper-slug-map";
// 문항 이미지·선지 수(DI) — 앱 CBT·오답노트가 웹 lib/wrong-notes.ts 와 같은 조회를 쓴다.
export * from "./data/question-media";
// 홈 랜딩·진단 소개의 순수 계산(시험 색인·오늘의 학습 현황·진단 주기·소개 CTA) — 웹 page.tsx·
// exam-index.ts·ai-diagnosis.ts 의 집계부와 앱 `/`·`/diagnosis` 가 같은 함수를 부른다.
export * from "./data/home";

// 마이페이지·응시 기록·출석·정답(RPC own_wrong_answers)·멤버십 FAQ (DI — 모바일 Phase 1a 계정 스트림)
export * from "./data/attempts";
export * from "./data/attendance";
export * from "./data/mypage";
export * from "./data/wrong-answers";
export * from "./membership-faq";
// 문항 오류 신고(RPC submit_question_report, DI) — 앱 신고 버튼이 부르는 유일한 경로(설계서 §6.7 #6).
export * from "./data/reports";
