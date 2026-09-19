// @gongmoa/core/server — 서버 전용 진입점.
//
// ⚠ 이 진입점은 apps/web 의 서버 코드(서버 액션·route handler·server-only lib)와
// supabase/functions(esbuild 번들 _shared/core.mjs 경유)만 import 한다.
// **apps/mobile 은 절대 import 하지 말 것** — 여기 모인 rules/* 는 service_role
// 클라이언트를 주입받는 규칙이라, 앱 번들에 섞이는 순간 "정답·멤버십·출석은 서버만
// 쓴다"는 전제가 코드 구조에서 사라진다(설계서 §3.2 — 앱은 ESLint no-restricted-imports
// 로 차단). 앱이 필요한 것은 Edge Function 계약(edge/*)과 순수 규칙(index.ts)뿐이다.
//
// 구성:
//   rules/*  — service_role 규칙. 웹 서버 액션과 Edge Function 은 이 함수들의 얇은 어댑터.
//   data/*   — DI 리포지토리 중 서버 조회에 쓰이는 것(정답 신호·문항 이미지·오답노트 마크·
//              정답·해설·메모·페이지네이션).
//   그리고 Edge 번들이 index.ts 없이도 돌 수 있게 순수 규칙 일부를 다시 내보낸다
//   (srs·review-pick·profanity·attendance·membership·paper-slug·format·dedup·댓글 상수).
//   Edge 가 더 필요한 순수 모듈이 생기면 여기에 한 줄 추가하고 `npm run bundle-edge`.

// ── 서버 규칙 ──────────────────────────────────────────────────────────────
export * from "./rules/question-status";
export * from "./rules/membership-server";
export * from "./rules/attendance-record";
export * from "./rules/explanation-access";
export * from "./rules/explanations";
export * from "./rules/explanations-wrong-note";
export * from "./rules/cbt-attempt";
export * from "./rules/status-targets";
export * from "./rules/review-preferences";
// 프로필 사진 — 웹 서버 액션(uploadAvatar/removeAvatar)과 Edge `avatar-upload` 의 공통 규칙.
export * from "./rules/avatar";
export * from "./rules/review-queue";
export * from "./rules/review-session";
export * from "./rules/mix-practice";
// AI 약점 진단 — 요청 행 생성(웹 서버 액션·Edge diagnosis-request)과 무AI 집계
// (웹 진단 페이지·Edge diagnosis-aggregate).
export * from "./rules/diagnosis-request";
export * from "./rules/diagnosis-aggregate";
// 리포트 생성(준비·저장)과 Message Batches 제출·수거. 예전에는 웹 크론 전용이라 웹 lib 에
// 있었지만, 지금은 **요청한 그 순간 제출하고 기다리는 동안 수거**하므로 Edge 도 같은
// 함수를 부른다(diagnosis-request·diagnosis-collect). 프롬프트·모델·max_tokens·custom_id·
// 합치기가 두 벌이 되면 어긋난 날 요금이 나간 뒤에 안다.
export * from "./rules/diagnosis-generate";
export * from "./rules/diagnosis-batch";
// 자유게시판·공지 댓글 쓰기(Phase 5 1라운드) — 웹 서버 액션(board/actions.ts·notices/actions.ts)과
// Edge `board-write`·`notices-write` 의 공통 규칙. 시간당 한도와 알림 행 만들기도 같은 묶음이다
// (한쪽에만 있으면 웹에서 막히는 글이 앱에서는 들어간다).
export * from "./rules/hourly-limit";
export * from "./rules/notify";
export * from "./rules/board";
export * from "./rules/notices";

// ── 서버 조회(DI) ──────────────────────────────────────────────────────────
export * from "./data/dedup-signals";
export * from "./data/question-media";
export * from "./data/query-utils";
export * from "./data/wrong-notes";
export * from "./data/subjects";
// 문제지 카탈로그 — Edge `mix-create` 의 허브(§6.7 #14)가 웹 lib/all-papers.ts 와 같은
// 목록·정렬(fetchExamPaperRows)을 쓴 뒤 dedup 대표로 접어 buildMixHubIndex 에 넘긴다.
export * from "./data/papers";

// ── Edge 번들이 함께 쓰는 순수 규칙(index.ts 의 부분집합) ────────────────
export * from "./srs";
export * from "./review-pick";
export * from "./profanity";
export * from "./attendance";
export * from "./membership";
export * from "./paper-slug";
export * from "./format";
export * from "./dedup-papers";
export * from "./comment-constraints";
export * from "./nickname";
// 프로필 사진의 순수 규칙(경로 모양·공개 URL·구워진 webp 검사). Edge 어댑터가 응답에
// 넣을 URL 을 만들고, 규칙이 바이트를 검사하는 데 쓴다.
export * from "./avatar";
// 게시판 본문 이미지의 순수 규칙(URL 접두사·구워진 webp 검사·base64 상한)과 게시판·공지·알림의
// 순수 검증. Edge 어댑터가 상한을 읽고 규칙이 검증을 부른다.
export * from "./board-image";
export * from "./board";
export * from "./notices";
export * from "./notifications";
export * from "./rich-text";
export * from "./ugc";
// 진단 리포트 스키마·개념 선택 정규화·코칭 대상 선정(순수) — 웹 생성기와 Edge 가 같은 것을 쓴다.
export * from "./diagnosis-report";
export * from "./diagnosis-targets";
// 극복법 프롬프트·JSON 스키마·max_tokens·모델과 배치 custom_id·합치기(순수). **index.ts 에는
// 두지 않는다** — 앱은 프롬프트를 알 이유가 없고, 리포트를 만드는 쪽은 서버뿐이다.
export * from "./diagnosis-coach";
export * from "./diagnosis-batch-merge";
