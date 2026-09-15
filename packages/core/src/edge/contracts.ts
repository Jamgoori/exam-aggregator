// Edge Function 요청/응답 계약 — supabase/functions/*/index.ts 가 **지금** 돌려주는 모양 그대로.
//
// 규칙(설계서 §6.6 "Edge 계약 버전", docs/agents/edge-core-bundle.md "응답 계약"):
//   · 응답은 추가만(add-only). 필드 삭제·이름 변경·타입/의미 변경 금지. 오래된 앱(스토어
//     심사·OTA 지연)이 오늘의 Edge 를 부른다.
//   · 깨지는 변경이 필요하면 새 함수명(`cbt-submit-v2`)으로 만들고 옛 함수는 남긴다.
//   · 요청 필드는 optional 추가만. 새 필수 필드는 곧 깨지는 변경이다.
//   · 앱은 이 타입만 import 한다 — `@gongmoa/core` 의 `EdgeContracts`/`invokeEdge` 로만
//     Edge 를 부르고, 앱 lib 에 지역 응답 타입을 다시 만들지 않는다(§6.8 `edge/contracts.ts`).
//   · 웹 어댑터(서버 액션)의 반환 타입도 같은 타입을 써서 두 어댑터가 갈라지지 않게 한다.
//
// 이 파일은 앱 번들(apps/mobile)에 실린다. 그래서 rules/* 에서는 **`import type` 만** 한다 —
// service_role 규칙 본문이 앱 번들에 섞이면 안 되고(server.ts 머리말), 타입만 가져와도
// 규칙 쪽 타입이 바뀌면 여기와 앱이 함께 typecheck 로 깨진다(의도한 드리프트 감지).
//
// 오류 계약: 성공이 아니면 `{ error: string }` 본문과 HTTP 상태 — `EdgeErrorBody`·
// `EdgeErrorStatus` 참고. 앱은 edge/invoke.ts 의 `EdgeError { status, code?, message }` 로 받는다.

import type { CbtSubmitSuccess } from "../rules/cbt-attempt";
import type { ExplanationAccess } from "../rules/explanation-access";
import type { QuestionExplanationContent } from "../rules/explanations";
import type {
  ReviewHistoryEntry,
  ReviewResultItem,
  ReviewSolveItem,
} from "../rules/review-session";
import type { Membership } from "../membership";
import type { ReviewPickStrategy } from "../review-pick";

// ── 오류 ────────────────────────────────────────────────────────────────────

// 실패 응답 본문. `error` 는 화면에 그대로 띄우는 한국어 문구(웹 서버 액션과 같은 문장) —
// 앱이 다시 쓰지 않고 그대로 보여준다(§6.9 오류 타입).
export type EdgeErrorBody = { error: string };

// 실패 응답의 HTTP 상태(§6.9 상태별 처리).
//   400 잘못된 요청·규칙 거절("이미 채점된 세션이에요." 등)   401 로그인 필요(requireUser)
//   403 멤버십 잠금·남의 리소스                                  404 세션 없음
//   426 update-required(x-gongmoa-app-build < minBuild, 본문 `{ error: "update-required" }`)
//   429 잠시 후 다시                                             500 서버 실패
// ai-diagnose 만 예외적으로 202(생성 중)·502(모델 호출 실패)·503(미설정)을 쓴다 —
// 202 는 2xx 라 supabase-js 가 error 로 주지 않으므로 invoke.ts 가 본문의 `error` 로 잡는다.
export type EdgeErrorStatus = 400 | 401 | 403 | 404 | 426 | 429 | 500;

// 426 일 때 EdgeError.code 값. 앱은 이 코드로 ForceUpdateScreen 을 띄운다.
export type EdgeErrorCode = "update-required" | "aborted" | "network";

// ── cbt-start ────────────────────────────────────────────────────────────────

export type CbtStartRequest = { paperId: string };
// startedAt 을 타이머 기준시각으로 써야 한다(rules/cbt-attempt.ts 머리말).
export type CbtStartResponse = { success: true; startedAt: string };

// ── cbt-submit ───────────────────────────────────────────────────────────────

// answers[i] = i+1 번 문항의 선택(1~5), 건너뛴 문항은 null. 서버가 sanitizeSelectedChoice 로 정제.
export type CbtSubmitRequest = { paperId: string; answers: (number | null)[] };
// 규칙 결과(CbtSubmitSuccess)에 success 를 붙인 것. diagnosisProgress 는 §6.7 #2 추가 필드 —
// 규칙이 집계에 실패하면 undefined 인데 Edge 는 null 로 직렬화한다.
export type CbtSubmitResponse = { success: true } & Omit<CbtSubmitSuccess, "diagnosisProgress"> & {
  diagnosisProgress: NonNullable<CbtSubmitSuccess["diagnosisProgress"]> | null;
};

// ── explanations-get ─────────────────────────────────────────────────────────

// 비로그인도 부를 수 있다(미리보기 ANON_PREVIEW_CARDS 문항만).
export type ExplanationsGetRequest = { paperId: string };
export type ExplanationQuestion = {
  questionNumber: number;
  correctChoice: number | null;
  choiceCount: number;
  images: string[];
  explanation: QuestionExplanationContent;
};
export type ExplanationsGetResponse = {
  // hasFullAccess 가 false 면 앞 ANON_PREVIEW_CARDS 문항만 들어 있다(나머지는 hiddenCount).
  questions: ExplanationQuestion[];
  totalCount: number;
  hiddenCount: number;
  hasFullAccess: boolean;
  loggedIn: boolean;
  // null | "rate-limit" | "free-quota" — "잠시 후 다시"와 결제 유도를 가른다.
  lockReason: ExplanationAccess["reason"];
  // 무료 회원의 오늘 남은 무료 해설 문제지 수(이번 요청 반영). 유료·관리자·비로그인은 null.
  // §6.7 #7 추가 필드.
  remainingToday: number | null;
};

// ── membership-get ───────────────────────────────────────────────────────────

export type MembershipGetRequest = Record<string, never>;
export type MembershipGetResponse = {
  // 계정이 들고 있는 기간 그대로("언제까지" 표시용).
  membership: Membership;
  isAdmin: boolean;
  // 관리자 우대·전면 무료 기간을 포함한 최종 판정.
  isPremium: boolean;
};

// ── review-create ────────────────────────────────────────────────────────────

export type ReviewItemRequestRef = { paperId: string; questionNumber: number };
// 전부 optional — 아무것도 없으면 "전 과목 미극복 오답 20문항". 분기 우선순위는
// paperIds → items → conceptId/concept → subjectSlug → 전 과목(review-create/index.ts).
export type ReviewCreateRequest = {
  subjectSlug?: string;
  onlyUnresolved?: boolean;
  includeResolved?: boolean;
  // 복습(간격 반복) — 멤버십. 웹과 같은 확인.
  onlyDue?: boolean;
  paperIds?: string[];
  items?: ReviewItemRequestRef[];
  // 같은개념 기출 — 멤버십.
  conceptId?: string | null;
  concept?: string;
  // 1~50. 없으면 20(개념 기출은 5).
  limit?: number;
  strategy?: ReviewPickStrategy;
  // 멱등 키(UUID, 생성마다 새로). 같은 값이면 언제나 같은 세션(§6.6).
  requestId?: string;
};
// 정답·출처(paperId/correctChoice/paperTitle/questionNumber)는 절대 싣지 않는다.
export type ReviewCreateResponse = {
  sessionId: string;
  total: number;
  items: ReviewSolveItem[];
  // scope 이하는 추가 필드.
  scope: string;
  subjectSlug: string | null;
  subjectName: string | null;
};

// ── review-submit ────────────────────────────────────────────────────────────

export type ReviewSubmitRequest = { sessionId: string; answers: (number | null)[] };
// "이미 채점된 세션이에요."(400)를 받으면 review-history { sessionId } 로 채점 뷰를 가져온다.
export type ReviewSubmitResponse = {
  score: number;
  total: number;
  items: ReviewResultItem[];
  sessionId: string;
  // guessed·paperId(items)·scope 이하가 §6.7 #9 추가 필드.
  scope: string;
  subjectSlug: string | null;
  subjectName: string | null;
  createdAt: string;
};

// ── review-history ───────────────────────────────────────────────────────────

// body 없음 / { scope?, subjectSlug?, limit? } → 목록. { sessionId } → 세션 상세.
export type ReviewHistoryListRequest = {
  sessionId?: undefined;
  scope?: string;
  subjectSlug?: string;
  // 1~200, 기본 50.
  limit?: number;
};
export type ReviewHistoryDetailRequest = {
  sessionId: string;
  // true 면 채점 전 세션도 돌려준다(답·정답·출처 없이). 없이 채점 전 세션을 물으면 400.
  includeUnsubmitted?: boolean;
};
export type ReviewHistoryRequest = ReviewHistoryListRequest | ReviewHistoryDetailRequest;

// 목록 항목 — 규칙의 ReviewHistoryEntry 와 같은 키(subjectSlug·createdAt 은 추가 필드).
export type ReviewHistoryListEntry = ReviewHistoryEntry;
export type ReviewHistoryListResponse = { sessions: ReviewHistoryListEntry[] };
// 세션 상세 — review-submit 응답과 같은 모양 + submitted. 채점 전이면 score null.
export type ReviewHistoryDetailResponse = Omit<ReviewSubmitResponse, "score"> & {
  score: number | null;
  submitted: boolean;
};
export type ReviewHistoryResponse = ReviewHistoryListResponse | ReviewHistoryDetailResponse;

// 응답 판별 — 목록이면 sessions, 상세면 sessionId.
export function isReviewHistoryList(r: ReviewHistoryResponse): r is ReviewHistoryListResponse {
  return "sessions" in r;
}

// ── comments-write ───────────────────────────────────────────────────────────

// 로그인 사용자 댓글만(비회원 댓글은 웹 전용). 닉네임은 서버가 user_metadata 에서 채운다.
export type CommentsWriteRequest =
  | { action: "create"; paperId: string; content: string; parentId?: string | null }
  | { action: "update"; commentId: string; content: string }
  | { action: "delete"; commentId: string };
export type CommentsWriteResponse = { ok: true };

// ── account-delete ───────────────────────────────────────────────────────────

export type AccountDeleteRequest = Record<string, never>;
export type AccountDeleteResponse = { ok: true };

// ── ai-diagnose ──────────────────────────────────────────────────────────────

// 리포트 스키마는 웹 lib/ai-diagnosis.ts AiDiagnosisReport 의 필수 부분(summary·weakConcepts·
// subjectTrends)과 같다. 웹의 선택 필드(mission·insights·conceptCoaching)는 Edge 가 만들지
// 않는다 — 필요해지면 optional 로 **추가**한다. Phase 4 에 diagnosis-request 로 대체 예정(§6.7 #21).
export type DiagnosisWeakConcept = {
  concept: string;
  subject: string | null;
  subjectSlug: string | null;
  wrongCount: number | null;
  resolvedCount: number | null;
};
export type DiagnosisSubjectTrend = {
  subject: string;
  trend: "up" | "down" | "flat";
  note: string;
};
export type AiDiagnosisReport = {
  summary: string;
  weakConcepts: DiagnosisWeakConcept[];
  subjectTrends: DiagnosisSubjectTrend[];
};
export type AiDiagnoseRequest = Record<string, never>;
export type AiDiagnoseResponse = {
  report: AiDiagnosisReport;
  // KST YYYY-MM-DD.
  date: string;
  // 최근 7일 안의 리포트를 그대로 돌려줬으면 true.
  cached: boolean;
};

// ── 맵 ──────────────────────────────────────────────────────────────────────

export type EdgeContracts = {
  "cbt-start": { request: CbtStartRequest; response: CbtStartResponse };
  "cbt-submit": { request: CbtSubmitRequest; response: CbtSubmitResponse };
  "explanations-get": { request: ExplanationsGetRequest; response: ExplanationsGetResponse };
  "membership-get": { request: MembershipGetRequest; response: MembershipGetResponse };
  "review-create": { request: ReviewCreateRequest; response: ReviewCreateResponse };
  "review-submit": { request: ReviewSubmitRequest; response: ReviewSubmitResponse };
  "review-history": { request: ReviewHistoryRequest; response: ReviewHistoryResponse };
  "comments-write": { request: CommentsWriteRequest; response: CommentsWriteResponse };
  "account-delete": { request: AccountDeleteRequest; response: AccountDeleteResponse };
  "ai-diagnose": { request: AiDiagnoseRequest; response: AiDiagnoseResponse };
};

export type EdgeName = keyof EdgeContracts;
export type EdgeRequest<N extends EdgeName> = EdgeContracts[N]["request"];
export type EdgeResponse<N extends EdgeName> = EdgeContracts[N]["response"];

// 배포된 Edge Function 이름 전부(계약 테스트·앱 목록용). 맵과 어긋나면 typecheck 가 잡는다.
export const EDGE_NAMES = [
  "cbt-start",
  "cbt-submit",
  "explanations-get",
  "membership-get",
  "review-create",
  "review-submit",
  "review-history",
  "comments-write",
  "account-delete",
  "ai-diagnose",
] as const satisfies readonly EdgeName[];
