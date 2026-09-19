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
  MixHubIndex,
  MixOverview,
  MixSessionQuestion,
  MixSessionSummary,
  MixSessionWrongNote,
} from "../rules/mix-practice";
import type { BoardConcept, BoardSubjectGroup } from "../rules/diagnosis-aggregate";
import type { AiDiagnosisReport, DiagnosisConceptSelection } from "../diagnosis-report";
import type { ReviewPrefs, ReviewSubjectOption } from "../rules/review-preferences";
import type { DueReviewSummary } from "../rules/review-queue";
import type {
  ReviewHistoryEntry,
  ReviewResultItem,
  ReviewSolveItem,
} from "../rules/review-session";
import type { ChatSentMessage } from "../rules/chat";
import type {
  SuggestionCommentItem,
  SuggestionDetail,
  SuggestionListItem,
} from "../rules/suggestions";
import type { Membership } from "../membership";
import type { ReviewPickStrategy } from "../review-pick";
import type { SessionSchedule } from "../review-queue";
import type { StudyPhase } from "../study-phase";

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

// 비로그인도 부를 수 있다(미리보기 ANON_PREVIEW_CARDS 문항만) — 단 wrong-note 모드는 로그인 필수.
export type ExplanationsGetRequest = {
  paperId: string;
  // 없으면 지금까지의 **해설 페이지 모드**(시간당 한도 → 무료 일일 몫 → 미리보기).
  // "wrong-note" 는 오답노트·응시 상세·mix 기록 **안에서** 여는 해설(§6.7 #7):
  // 프리미엄 + 본인이 답한 문항만 본문을 내주고, explanation_access_log·
  // explanation_daily_views 를 쓰지 않는다(= 쿼터 미차감, 웹 오답노트와 같은 동작).
  context?: "wrong-note";
  // wrong-note 모드에서 해설을 물을 문항 번호(1~300, 최대 WRONG_NOTE_QUESTION_LIMIT).
  // 서버가 "본인이 답한 문항"(형제 문제지 매핑 포함, RPC own_wrong_answers 와 같은 판정)으로
  // 한 번 더 좁힌다. 페이지 모드에서는 무시된다.
  questionNumbers?: number[];
};
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
  // §6.7 #7 추가 필드. wrong-note 모드에서는 쿼터를 보지 않으므로 언제나 null.
  remainingToday: number | null;
  // ── 아래 둘은 context:"wrong-note" 모드에서만 실린다(추가 필드, 페이지 모드는 undefined) ──
  // true 면 "해설은 있지만 멤버십이 아니라 본문을 안 보냈다" — 앱은 잠금 자리를 그린다.
  // 페이지 모드의 lockReason("rate-limit"/"free-quota")과 섞지 말 것: 이 모드는 시간당
  // 한도도 무료 일일 몫도 판정하지 않으므로 lockReason 은 언제나 null 이다.
  explanationLocked?: boolean;
  // 잠긴 문항 번호(해설이 등록돼 있고 본인이 답한 문항). 프리미엄이면 빈 배열.
  lockedQuestionNumbers?: number[];
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
  // "mix-note": 기출 섞어풀기 한 세션의 오답노트 화면(웹 /mypage/wrong-notes/[slug]/mix/
  // [sessionId], §6.7 #10). 응답에 `mixNote` 가 **추가로** 실린다 — 기존 상세 필드
  // (score·total·items…)는 그대로 있으므로 옛 앱·다른 화면은 그대로 컴파일·동작한다.
  // 채점 전 세션이나 scope 이 "mix" 가 아닌 세션이면 404.
  view?: "mix-note";
};
// 상태 전용 오답의 "마지막에 고른 답"(§9 "상태 전용 오답(mix) 합산·마지막 선택").
// 응시 없이 채점된 오답(기출 섞어풀기·같은개념 기출)은 `user_question_status` 에만 있어 앱이
// 목록에 보탤 수는 있지만, 그때 고른 답은 `review_session_items` 에 있고 그 테이블은 RLS 정책이
// 0개라 앱이 못 읽는다. 과목 하나 분량을 한 번에 받아 `${paperId}#${questionNumber}` 로 찾는다.
export type ReviewHistoryLastChoicesRequest = {
  view: "last-choices";
  subjectSlug: string;
};
export type ReviewHistoryRequest =
  | ReviewHistoryListRequest
  | ReviewHistoryDetailRequest
  | ReviewHistoryLastChoicesRequest;

// 목록 항목 — 규칙의 ReviewHistoryEntry 와 같은 키(subjectSlug·createdAt 은 추가 필드).
//
// `scope:"mix"` + `subjectSlug` 로 물었을 때만 뒤 셋이 더 실린다(추가 필드라 optional):
// 규칙 listMixSessions 가 만드는 웹 카드와 같은 값 — `title` 은 같은 날 순번이 붙은
// "9월 5일 섞어풀기 (2)", `wrongCount` 는 그 세션에서 틀린 문항 수, `resolvedCount` 는 그중
// 지금은 극복한(가장 최근 채점에서 맞힌) 수다. Phase 2 가 이 세 값이 없어 앱 MixSessionList
// 를 미뤘다(§12-4). 과목을 특정해야 계산할 수 있어(극복 판정이 그 과목의 dedup 대표 매핑을
// 쓴다) 다른 조합에서는 undefined 다.
export type ReviewHistoryListEntry = ReviewHistoryEntry &
  Partial<Pick<MixSessionSummary, "title" | "wrongCount" | "resolvedCount">>;
export type ReviewHistoryListResponse = { sessions: ReviewHistoryListEntry[] };

// mix 기록 뷰(§6.7 #10, view:"mix-note"). 규칙 getMixSessionWrongNote 의 반환을 그대로 싣는다
// — 웹 /mypage/wrong-notes/[slug]/mix/[sessionId] 페이지가 받는 값과 같은 모양이라 앱 화면이
// 웹과 같은 것을 그린다(문항별 출처 문제지 제목·급수·시행처, 정오, 메모·다시보기 표시,
// 통합 상태 기준 wrongCount·resolved). 해설 본문은 프리미엄일 때만 채워지고, 그 외에는
// explanationLocked=true 로 잠금 자리를 그린다(오답노트와 같은 규칙).
//
// **앱은 이 값을 디스크에 남기지 않는다**(correctChoice·해설 본문 — §6.5, apps/mobile/AGENTS.md
// "정답·해설·멤버십을 디스크에 남기지 말 것"): 쿼리 meta.persist:false 대상.
export type ReviewHistoryMixNoteQuestion = MixSessionQuestion;
export type ReviewHistoryMixNote = MixSessionWrongNote;

// 세션 상세 — review-submit 응답과 같은 모양 + submitted. 채점 전이면 score null.
export type ReviewHistoryDetailResponse = Omit<ReviewSubmitResponse, "score"> & {
  score: number | null;
  submitted: boolean;
  // view:"mix-note" 로 물었을 때만 실린다(추가 필드).
  mixNote?: ReviewHistoryMixNote;
};
// view:"last-choices" 응답. 정답은 실리지 않는다 — **내가 골랐던 답**뿐이라 이미 내 것이다.
// 없는 과목이면 빈 배열(오류가 아니다 — 그 과목에 세션 기록이 없을 뿐이다).
export type ReviewHistoryLastChoicesResponse = {
  choices: { paperId: string; questionNumber: number; selectedChoice: number | null }[];
};

export type ReviewHistoryResponse =
  | ReviewHistoryListResponse
  | ReviewHistoryDetailResponse
  | ReviewHistoryLastChoicesResponse;

// 응답 판별 — 목록이면 sessions, 상세면 sessionId, 마지막 선택이면 choices.
export function isReviewHistoryList(r: ReviewHistoryResponse): r is ReviewHistoryListResponse {
  return "sessions" in r;
}
export function isReviewHistoryLastChoices(
  r: ReviewHistoryResponse,
): r is ReviewHistoryLastChoicesResponse {
  return "choices" in r;
}
// 세션 상세만 남기는 좁히기. `{ sessionId }` 로 물었으면 상세가 오지만, 계약 타입은 함수 이름
// 단위라 세 응답이 한 유니온에 있다 — 호출부가 매번 두 번 걸러내지 않게 여기 하나로 둔다.
export function isReviewHistoryDetail(
  r: ReviewHistoryResponse,
): r is ReviewHistoryDetailResponse {
  return "sessionId" in r;
}

// ── review-guessed (§6.7 #11) ────────────────────────────────────────────────

// "찍었어요" — 채점 결과 화면에서 **맞힌** 문항의 복습 스케줄만 되돌린다(SRS_RELEARN_DELAY_HOURS).
// 단방향·멱등(§6.6 "SRS"): 여러 번 눌러도 결과가 같고, 취소하는 요청은 없다.
// 멤버십으로 막지 않는다(§8.3 "찍었어요" 행). 틀린 문항·스케줄이 없는 문항은 조용히 무시(ok:true).
// RPC 가 아니라 EF 인 이유는 supabase/functions/review-guessed/index.ts 머리말 참고
// (SQL 에 SRS 상수를 두면 srs.ts 밖의 세 번째 사본이 되고 CI 게이트가 못 잡는다).
export type ReviewGuessedRequest = { sessionId: string; position: number };
export type ReviewGuessedResponse = { ok: true };

// ── review-due (§6.7 #12) ────────────────────────────────────────────────────

// "오늘의 복습"(간격 반복). **다섯 액션 모두 프리미엄**이고, 아니면 403
// `{ error: "오늘의 복습(간격 반복)은 멤버십 기능이에요." }` 다(§8.3) — 앱은 그 403 을
// "숫자 없는 잠긴 카드"로 그린다(게이트를 앱에서 실행하지 않는다).
export type ReviewDueRequest =
  // 배너·설정 화면의 요약. 읽기만 하므로 대기 풀 승격이 일어나지 않는다(§6.6 "SRS").
  | { action: "summary" }
  // 오늘의 복습 세션 시작. 24시간 안에 두고 나온 due 세션이 있으면 **그것을 돌려준다**
  // (resumed:true, 웹 createDueReviewSession 과 같은 판정) — 새로 만들면 기기에 저장해 둔
  // 답이 안 붙는다. requestId 는 재시도 멱등 키(UUID, 생성마다 새로 — §6.6).
  | { action: "create"; requestId?: string }
  // "복습 더하기" — 오늘치를 끝낸 사람이 대기 풀에서 한 묶음 더. 오늘 큐에 남은 것이 있으면
  // 400 "오늘 예정된 복습을 먼저 끝내주세요.", 대기가 없으면 400 "더 가져올 오답이 없어요."
  | { action: "extra"; requestId?: string }
  // 채점 결과 화면의 "다음 복습" 섹션. 남의 세션·채점 전 세션이면 schedule:null(오류 아님).
  | { action: "schedule"; sessionId: string }
  // 홈 복습 유도 모달. 요약에서 두 값만 잘라 보낸다.
  | { action: "nudge" };

// action:"summary" — 규칙 getDueReviewSummary 의 반환 그대로(todayCount·forecast 가
// §12 Phase 3 종료 조건 "웹과 앱에서 같은 날 같은 todayCount·forecast"의 비교 대상).
export type ReviewDueSummaryResponse = DueReviewSummary;

// action:"create"|"extra" — review-create 응답과 **같은 모양** + resumed(추가 필드).
// 정답·출처(paperId/correctChoice/paperTitle/questionNumber)는 실리지 않는다.
export type ReviewDueSessionResponse = {
  sessionId: string;
  total: number;
  items: ReviewSolveItem[];
  scope: string;
  subjectSlug: string | null;
  subjectName: string | null;
  // 두고 나온 세션을 이어 받았는지. extra 는 언제나 false.
  resumed: boolean;
};

// action:"schedule" — 규칙 getSessionSchedule 의 반환(문항별 "며칠 뒤" + 향후 7일 예보).
export type ReviewDueScheduleResponse = { schedule: SessionSchedule | null };

// action:"nudge" — 웹 getReviewNudge 와 같은 값.
export type ReviewDueNudgeResponse = {
  todayCount: number;
  subjects: { name: string; count: number }[];
};

export type ReviewDueResponse =
  | ReviewDueSummaryResponse
  | ReviewDueSessionResponse
  | ReviewDueScheduleResponse
  | ReviewDueNudgeResponse;

// 응답 판별(isReviewHistoryList 와 같은 방식) — 호출부는 자기가 보낸 action 을 알지만,
// 계약 타입은 함수 이름 단위라 좁혀 줄 자리가 필요하다. 네 응답의 키는 서로 겹치지 않는다:
// 세션 = sessionId, 요약 = forecast, 일정 = schedule, 넛지 = 나머지(todayCount + subjects).
export function isReviewDueSession(r: ReviewDueResponse): r is ReviewDueSessionResponse {
  return "sessionId" in r;
}
export function isReviewDueSummary(r: ReviewDueResponse): r is ReviewDueSummaryResponse {
  return "forecast" in r;
}
export function isReviewDueSchedule(r: ReviewDueResponse): r is ReviewDueScheduleResponse {
  return "schedule" in r;
}

// ── review-prefs (§6.7 #13) ──────────────────────────────────────────────────

// `review_preferences` 의 **모든 쓰기**가 여기로 온다 — 앱은 이 테이블을 읽기만 한다(§6.2).
// RLS 로 직접 쓰면 멤버십 게이트·과목 재개 재분산·study_phase 히스테리시스가 통째로 우회된다.
//
// 프리미엄 게이트(웹 actions.ts 와 같은 목록): `daily-limit`·`pause`·`spread`·`restore` 는
// 403 + REVIEW_LOCKED. `study-phase`·`diagnosis-pause`·읽기는 웹에도 게이트가 없다.
export type ReviewPrefsRequest =
  // 설정 화면이 한 번에 읽는 것. 빈 body(`{}`)도 같다.
  | { action?: "get" }
  // 하루 문항 수. 값 검증(DAILY_LIMIT_OPTIONS = 10/20/40/60)은 서버가 한다 —
  // 목록 밖이면 400 "고를 수 없는 값이에요."
  | { action: "daily-limit"; limit: number }
  // 복습 과목 보류/재개. 재개(paused:false)면 서버가 밀린 문항의 srs_due_at 을 며칠에 걸쳐
  // 다시 뿌린다(service_role 쓰기 — 앱이 이 테이블을 직접 못 쓰는 가장 큰 이유).
  | { action: "pause"; subjectId: string; paused: boolean }
  // AI 약점 진단에서 뺄 과목(복습 보류와 다른 컬럼 — schema.sql). 재분산 없음.
  | { action: "diagnosis-pause"; subjectId: string; paused: boolean }
  // 직전 판정 국면 저장. 판정 자체는 core `detectStudyPhase`(순수, 앱도 부를 수 있다)가 하고
  // 여기는 히스테리시스의 입력을 남기는 쓰기다. 국면이 **바뀐 순간에만** 부를 것.
  | { action: "study-phase"; phase: StudyPhase }
  // "밀린 복습 정리하기" — 연체분을 오늘부터 며칠에 걸쳐 다시 뿌린다.
  | { action: "spread" }
  // 접어둔(leech) 문항 되살리기.
  | { action: "restore" };

// 응답은 액션과 무관하게 같은 모양이다(추가만). 쓰기 뒤에도 갱신된 설정을 그대로 실어 보내
// 앱이 토글 직후 다시 부르지 않아도 된다(웹 revalidatePath 에 해당하는 자리).
export type ReviewPrefsResponse = {
  // 최종 멤버십 판정(관리자·전면 무료 포함). false 면 앱은 설정 패널을 잠긴 카드로 그린다.
  premium: boolean;
  dailyLimit: ReviewPrefs["dailyLimit"];
  // Set 이 아니라 배열로 직렬화된다(규칙의 ReviewPrefs.pausedSubjectIds 는 Set).
  pausedSubjectIds: string[];
  diagnosisPausedSubjectIds: string[];
  // 저장된 직전 국면(없으면 null — 첫 판정).
  studyPhase: StudyPhase | null;
  // action:"get" 에서만. 무료 사용자에게는 빈 배열이다(§8.3 "숫자 없음").
  subjects?: ReviewSubjectOption[];
  // action:"spread"/"restore" 에서만 — 다시 뿌린/되살린 문항 수.
  spreadCount?: number;
  restoredCount?: number;
};

// ── mix-create (§6.7 #14) ────────────────────────────────────────────────────

// 기출 섞어풀기(한 과목의 기출 전체에서 새 문제를 뽑아 푼다). 멤버십 게이트 없음 —
// 웹에서도 무료다(§8.3 첫 줄). hub·overview 는 정답을 싣지 않는 공개 통계라 **비로그인도
// 부를 수 있고**, 사용자 행을 만드는 create·retry 만 로그인 필수다(401 "로그인 후 이용할 수
// 있어요."). 웹이 목록·시작 패널을 로그인 전에 보여주고 "시작"에서만 로그인으로 보내는 것과
// 같은 경계다 — 앱도 그대로 따른다.
export type MixCreateRequest =
  // /mix 허브의 급수 탭·과목 목록.
  | { action: "hub" }
  // 시작 화면 요약(급수·연도 교차 문항 수). 없는 과목이면 404.
  | { action: "overview"; subjectSlug: string }
  // 세션 생성. levels 는 풀에 실제로 있는 급수 키만 받아들이고(빈 배열 = 전체),
  // yearRange 는 자료가 있는 구간 안으로 정리된다. limit 은 서버가 다시 묶는다(clampMixLimit).
  | {
      action: "create";
      subjectSlug: string;
      levels?: string[];
      yearRange?: { from?: number | null; to?: number | null };
      limit?: number;
      requestId?: string;
    }
  // 기록·결과 화면의 "틀린 N문항만 다시 풀기". 문항 목록은 서버가 세션에서 직접 읽는다
  // (클라이언트가 (문제지, 문항)을 보내면 채점 응답의 공식 정답이 새어 나간다).
  // 채점 전 세션이면 400, 남의 세션이면 400 "세션을 찾을 수 없어요."
  | { action: "retry"; sessionId: string; requestId?: string };

export type MixCreateHubResponse = MixHubIndex;
export type MixCreateOverviewResponse = MixOverview;

// create·retry — review-create 응답과 같은 모양(정답·출처 없음) + create 의 두 값.
export type MixCreateSessionResponse = {
  sessionId: string;
  total: number;
  items: ReviewSolveItem[];
  scope: string;
  subjectSlug: string | null;
  subjectName: string | null;
  // action:"create" 에서만. 뽑힌 문항 중 처음 보는 수 / 새 문항만으로 정원을 못 채웠는지
  // (= 이 과목 기출을 한 바퀴 돌았다).
  unseenCount?: number;
  coveredAll?: boolean;
};

export type MixCreateResponse =
  | MixCreateHubResponse
  | MixCreateOverviewResponse
  | MixCreateSessionResponse;

// 응답 판별 — 세션 = sessionId, 허브 = tiers, 요약 = 나머지(subject).
export function isMixCreateSession(r: MixCreateResponse): r is MixCreateSessionResponse {
  return "sessionId" in r;
}
export function isMixCreateHub(r: MixCreateResponse): r is MixCreateHubResponse {
  return "tiers" in r;
}

// ── comments-write ───────────────────────────────────────────────────────────

// 로그인 사용자 댓글만(비회원 댓글은 웹 전용). 닉네임은 서버가 user_metadata 에서 채운다.
export type CommentsWriteRequest =
  | { action: "create"; paperId: string; content: string; parentId?: string | null }
  | { action: "update"; commentId: string; content: string }
  | { action: "delete"; commentId: string };
export type CommentsWriteResponse = { ok: true };

// ── avatar-upload (§6.7 #16) ─────────────────────────────────────────────────
//
// 프로필 사진 등록·삭제. 웹 서버 액션(app/actions.ts#uploadAvatar/removeAvatar)과 같은
// 규칙(core rules/avatar.ts)을 부르는 다른 어댑터다.
//
// **이미지는 앱이 굽고 서버가 검사한다.** 웹은 서버에서 sharp 로 256px webp 를 굽지만
// Deno 에는 sharp 가 없다. 앱은 이미 들어 있는 @shopify/react-native-skia 로
// 256×256 webp 를 구워 보내고(새 네이티브 의존을 늘리면 OTA 가 깨진다), 서버는 받은
// 바이트가 정말 그 규격인지 헤더로 확인한다(core avatarBytesError — RIFF/WEBP 매직바이트 +
// 캔버스 크기 + 애니메이션 여부). 클라이언트가 말하는 MIME·확장자는 근거로 쓰지 않는다.
//
// 바이트를 싣는 방식은 **base64 문자열**이다. multipart 는 supabase-js `invoke` 로 다루기
// 번거롭고(Content-Type 경계 처리), JSON 본문 한 필드면 invokeEdge 를 그대로 쓴다. 대신
// base64 는 33% 부푸므로 상한도 그만큼 여유 있게 잡는다 — 바이트 상한
// AVATAR_ENCODED_MAX_BYTES(512KB)에 대응하는 문자 수 상한이 AVATAR_BASE64_MAX_CHARS 다
// (256px webp 는 보통 10~40KB 라 실제로는 한참 남는다).

export type AvatarUploadRequest =
  // webpBase64: 데이터 URL 접두(`data:image/webp;base64,`) 없이 base64 본문만.
  // expo-file-system 의 `readAsStringAsync(..., { encoding: 'base64' })` 결과 그대로.
  | { action: "upload"; webpBase64: string }
  | { action: "remove" };

export type AvatarUploadResponse = {
  success: true;
  // 저장 경로(`{userId}/{uuid}.webp`). 삭제했으면 null. 앱은 이 값을 화면 상태로 쓰지 말고
  // avatarUrl 을 쓴다 — 경로 → URL 변환 규칙(isValidAvatarPath)은 서버가 쥔다.
  avatarPath: string | null;
  // 공개 버킷의 사진 URL. 삭제했거나 경로가 규격 밖이면 null(= 첫 글자 아바타를 그린다).
  avatarUrl: string | null;
};

// ── account-delete ───────────────────────────────────────────────────────────
//
// 회원 탈퇴. 규칙은 core rules/account-delete.ts(설계서 §12-2 #17 — 본인 원글은 내용을 비워 "탈퇴한
// 회원의 글" 로 남기고 타인의 댓글은 유지, 댓글류는 닉네임만 익명화, 스토리지 정리, deleteUser).
// 웹도 같은 EF 를 부른다(delete-account-button.tsx). 오류는 전부 500 `{ error }` — 문구 4종
// ("댓글 정리에 실패했어요…" / "글 정리에 실패했어요…" / "계정 정리에 실패했어요…" / "계정 삭제에
// 실패했어요…"), 계정은 그대로라 다시 누르면 된다.

export type AccountDeleteRequest = Record<string, never>;
export type AccountDeleteResponse = { ok: true };

// ── ai-diagnose (폐기 — diagnosis-request/diagnosis-aggregate 로 대체) ────────
//
// 앱이 쓰던 **동기** 진단 함수다(그 자리에서 Claude 를 부르고 리포트를 저장·반환).
// 웹은 처음부터 요청 행만 만들고 Vercel 크론(Message Batches)이 채우는 구조라, 같은
// `ai_diagnoses` 행을 두 파이프라인이 서로 다른 스키마로 잠갔다(§2 "이미 어긋난 규칙").
// Phase 4 에서 아래 두 함수로 갈라졌다(§6.7 #21) — 새 코드는 그쪽을 쓴다.
//
// **계약은 지운다는 뜻이 아니다.** 스토어에 나가 있는 옛 빌드가 여전히 이 함수를 부르고,
// 응답 계약은 "추가만"이라 삭제·의미 변경이 금지다(§6.6 "Edge 계약 버전"). 함수도 계약도
// 그대로 둔 채 새 호출부만 만들지 않는다. 실제로 지우는 날 함께 고쳐야 할 곳은
// supabase/functions/ai-diagnose 머리 주석에 적어 뒀다.
//
// 리포트 타입은 이제 core `diagnosis-report.ts` 한 곳이다(웹 생성기·앱 화면·이 계약이
// 같은 JSON 을 본다). 예전에 여기 있던 3필드 판은 그 타입의 필수 필드와 같고, 선택 필드
// (mission·insights·conceptCoaching·frequency·accuracyPct·scores)가 더해진 것뿐이다 —
// ai-diagnose 가 만들지 않던 필드라 옛 응답도 그대로 이 타입을 만족한다.
export type {
  AiDiagnosisReport,
  DiagnosisWeakConcept,
  DiagnosisSubjectTrend,
  DiagnosisConceptCoaching,
  DiagnosisConceptSelection,
} from "../diagnosis-report";

export type AiDiagnoseRequest = Record<string, never>;
export type AiDiagnoseResponse = {
  report: AiDiagnosisReport;
  // KST YYYY-MM-DD.
  date: string;
  // 최근 7일 안의 리포트를 그대로 돌려줬으면 true.
  cached: boolean;
};

// ── diagnosis-request (§6.7 #21) ─────────────────────────────────────────────
//
// 진단 요청 행을 만들고 **그 자리에서 배치를 제출한다**(Message Batches API, 표준가의
// 50%). 예전에는 행만 만들고 제출·수거를 모두 웹 크론이 시간당 한 번 했다 — 최악이
// "제출 대기 1시간 + 배치 + 수거 대기 1시간"이었다. 지금 남는 것은 배치 자체의 처리
// 시간뿐이고(대부분 1시간 안), 앱은 기다리는 동안 `diagnosis-collect` 로 직접 수거한다.
//
// 응답에 리포트 본문은 없다 — 앱은 `ai_diagnoses` 를 RLS 로 직접 읽는다(select own,
// schema.sql). 웹 서버 액션 `requestDiagnosis` 와 **같은 core 규칙**
// (rules/diagnosis-request.ts#requestDiagnosisForUser + rules/diagnosis-batch.ts#
// submitPendingDiagnoses)을 부른다.
//
// 제출이 실패해도(키 미설정·API 오류) 이 함수는 200 이다 — 요청 행은 남고 시간당 웹
// 크론이 예전처럼 주워 간다. 여기서 5xx 를 내면 secret 이 없는 동안 진단이 통째로 죽는다.
//
// 오류: 403 "AI 약점 진단은 멤버십 기능이에요." · 400 자격 미달 안내 · 500 요청 실패.
export type DiagnosisRequestRequest = {
  // 화면에서 체크한 개념들. 서버가 상한(COACH_MAX_TOTAL=10)까지 자른다 — 개념 하나가
  // 곧 프롬프트 한 덩이이자 요금이라, 화면을 우회한 목록이 그대로 청구서가 되면 안 된다.
  // 생략하면 생성기가 알아서 상위 개념을 고른다.
  selectedConcepts?: DiagnosisConceptSelection[];
};
export type DiagnosisRequestResponse = {
  // ready  — 이번 주기 리포트가 이미 있다(주기 잠금, 새로 만들지 않았다)
  // pending— 요청 행이 있다. 극복법은 배치가 끝나면 채워진다
  status: "ready" | "pending";
  // 요청 행의 KST 날짜(YYYY-MM-DD). 앱이 폴링 대상 행을 고르는 축.
  date: string;
  // 이 주기가 풀리는 날(date + 7일). "다음 진단은 N월 N일부터" 안내용.
  nextDate: string;
  // 실제로 저장된 개념 수(상한으로 잘린 뒤). 화면이 "N개 개념으로 만들어요"를 이 수로 말한다.
  selectedCount: number;
  // 이 호출에서 배치를 실제로 제출했는지. false 여도 오류가 아니다 — 이미 진행 중이거나
  // (generating=true), 만들 게 없거나(submitError), 키가 아직 없는(크론이 줍는다) 경우다.
  submitted: boolean;
  // 지금 극복법이 만들어지는 중인지(방금 냈거나 이미 진행 중). 화면은 true 면 선택창을
  // 닫고 대기 카드를 띄운다 — 열어 두면 같은 진단을 두 번 누르게 된다.
  generating: boolean;
  // 제출하지 못한 사유 중 **사용자가 고칠 수 있는 것**(예: "최근 7일 동안 새로 틀린 문제가
  // 없어요"). 그대로 화면에 올린다. 없으면 null.
  submitError: string | null;
  // `diagnosis-collect` 를 부를 때 지켜야 할 최소 간격(초). 서버가 강제하는 값과 같다 —
  // 더 자주 불러도 Anthropic 을 두드리지 않고 pending 만 돌아온다.
  recheckSeconds: number;
};

// ── diagnosis-collect (§6.7 #21) ─────────────────────────────────────────────
//
// 앱이 결과를 기다리는 동안 부르는 **수거**. 진행 중인 내 배치가 끝났는지 보고, 끝났으면
// 그 자리에서 결과를 합쳐 리포트를 저장한다. 크론(시간당)은 안전망으로 그대로 남는다 —
// 앱을 닫은 사용자와 웹 요청이 그걸로 산다.
//
// 요청 본문은 없다(`{}`). 대상은 언제나 **호출자 본인의 이번 주기 진단**이다 — 남의 배치를
// 지목할 방법 자체를 두지 않는다.
//
// 오류: 401 로그인 필요. 그 외에는 200 이고 status 로 말한다(수거 실패와 "아직 안 끝남"은
// 사용자가 할 수 있는 일이 같다 — 기다리는 것뿐이다).
export type DiagnosisCollectRequest = Record<string, never>;

export type DiagnosisCollectResponse = {
  // none    — 이번 주기에 요청 자체가 없다(화면은 "진단 받기"를 그린다)
  // pending — 아직 만들어지는 중(배치 미완료·제출 대기·재확인 간격 전)
  // ready   — 리포트가 채워졌다. 앱은 `ai_diagnoses` 를 다시 읽어 본문을 그린다
  // failed  — 이 주기 배치가 실패로 닫혔다(사유는 error). 다시 요청할 수 있다
  status: "none" | "pending" | "ready" | "failed";
  // 이번 주기 요청 행의 KST 날짜(YYYY-MM-DD). 없으면 요청 자체가 없다.
  date: string | null;
  // 배치가 제출된 시각(ISO). 화면이 "N분째 만드는 중"을 말한다. 아직 제출 전이면 null.
  requestedAt: string | null;
  // 이 배치가 물어본 개념 수. 0 이면 아직 제출 전이다.
  conceptCount: number;
  // 실패 사유(사용자에게 그대로 보여줄 수 있는 문구). 그 외에는 null.
  error: string | null;
  // 다음 호출까지 기다릴 최소 간격(초). 서버가 강제하는 값과 같다.
  recheckSeconds: number;
};

// ── diagnosis-aggregate (§6.7 #21) ───────────────────────────────────────────
//
// 진단 대시보드(`/mypage/diagnosis`)가 그리는 **무AI 집계**. 웹 서버 컴포넌트가
// `getDiagnosisAggregate` + `pickCoachTargets` + 주기 조회로 만들던 props 를 한 번의
// 왕복으로 돌려준다(웹 page.tsx 가 하는 조회와 같은 순서·같은 규칙).
//
// **리포트 본문(conceptCoaching)은 여기 없다.** 앱이 `ai_diagnoses.report` 를 RLS 로 직접
// 읽는다 — 진단 본문은 메모리 쿼리캐시에만 두는 값이라(앱 AGENTS.md 금지선) 계약에 실어
// 두면 다른 응답에 섞여 디스크로 새기 쉽다. 정답·해설 본문은 이 응답에 절대 없다.
//
// 비용이 큰 조회다(계정 전체 응시 이력 → 기간 안 응답 → 문항·해설·개념 → 개념별 기출 수).
// 화면 진입·기간 칩 전환에만 부르고 폴링에 쓰지 말 것 — Edge 에는 웹의 `'use cache'` 에
// 해당하는 계층이 없다.

// 막대그래프의 개념 한 줄(core rules/diagnosis-aggregate 의 BoardConcept — 집계에서 화면이
// 쓰는 값만 남긴 것). 뺀 값과 그 이유는 그 파일의 "앱(Edge)용 투영" 절에 있다.
export type DiagnosisBoardConcept = BoardConcept;
export type DiagnosisBoardSubjectGroup = BoardSubjectGroup;

export type DiagnosisAggregateRequest = {
  // 그래프 기간(일). null 이면 전체 기간, 생략하면 7일(웹 기본 칩과 같다).
  days?: number | null;
  // 과목 필터. 웹 화면은 전 과목을 받아 클라이언트에서 거르므로 보통 생략한다.
  subjectSlug?: string | null;
};

// 선택창(체크박스) 한 줄. 웹 DiagnosisPickerConcept 와 같은 값이다.
export type DiagnosisPickerConcept = {
  // 개념 선택 키(정본 id 우선, 없으면 "kw:표기"). 화면 체크 상태의 키.
  key: string;
  concept: string;
  conceptId: string | null;
  subject: string | null;
  subjectSlug: string | null;
  wrongCount: number;
  accuracyPct: number | null;
  scoreGainPct: number | null;
  // 자동 선정(core pickCoachTargets)이 골랐을 개념. 처음에 체크된 상태로 뜬다.
  recommended: boolean;
};

export type DiagnosisAggregateResponse = {
  // 그래프가 실제로 그린 기간. widened=true 면 "선택한 기간에 푼 문제가 없어 넓혔다".
  window: { days: number | null; widened: boolean };
  // 과목 탭(응시한 과목 전체).
  subjects: { name: string; slug: string }[];
  // 개념 목록(wrongCount 내림차순, 최대 60개). 극복법 카드에 숫자를 붙일 때 쓰는 조회표.
  concepts: DiagnosisBoardConcept[];
  // 과목별 막대그래프 묶음(totalWrong 내림차순).
  bySubject: DiagnosisBoardSubjectGroup[];
  // 극복법이 훑는 기간(일, 항상 7). 그래프 기간과 다를 수 있어 선택창이 그대로 밝힌다.
  analysisDays: number;
  // 선택창에 뿌릴 개념. null 이면 지금은 만들 수 없는 상태(이미 받았거나·생성 중·
  // 최근 7일 오답이 없거나·자격 미달) — 화면은 선택창을 그리지 않는다.
  picker: DiagnosisPickerConcept[] | null;
  // 이번 주기 상태. requestedThisCycle 이면 선택창 대신 "다음 진단은 nextDate 부터".
  cycle: {
    requestedThisCycle: boolean;
    status: "ready" | "pending" | null;
    // 이번 주기 요청 행의 날짜. 앱이 이 날짜로 report 를 폴링한다.
    date: string | null;
    nextDate: string | null;
  };
  // 지금 극복법이 만들어지는 중이면 그 요청 시각과 개념 수. null 이면 대기 중이 아니다.
  // (`ai_diagnosis_batches` 는 service_role 전용이라 앱이 직접 못 읽는다 — 서버가 실어 준다.)
  generating: { requestedAt: string; conceptCount: number } | null;
  // 자격(오답 15 ∨ 응시 3). 빈 화면에서 "얼마나 남았는지" 진행 바를 그린다.
  eligibility: { eligible: boolean; attemptCount: number; wrongCount: number };
};

// ── board-write (§6.7 #17) ───────────────────────────────────────────────────
//
// 자유게시판 쓰기 전부(글·이미지·댓글). 웹 서버 액션 app/board/actions.ts 와 **같은 규칙**
// (core rules/board.ts)을 부르는 다른 어댑터다 — board_posts·board_comments 는 쓰기 정책이
// 회수돼 있어 앱이 표에 직접 쓸 길이 없고, 이 함수가 앱의 서버 액션 역할을 한다.
// 순서는 금지선 그대로 **새니타이즈(sanitizeRichText) → validateBoardPostInput → 저장**.
// 전부 로그인 필수(401). 시간당 한도 10/30/60 은 웹과 같은 값(core rules/hourly-limit.ts).
//
// **이미지는 앱이 굽고 서버가 검사한다**(avatar-upload 와 같은 결정, §12-8). 앱은 Skia 로
// 가로 ≤ BOARD_IMAGE_MAX_WIDTH(1600px) webp 를 구워 base64 한 필드로 보내고, 서버는 헤더만
// 읽어 RIFF/WEBP·폭·픽셀 수·애니메이션·RIFF 선언 길이를 본다(core boardImageBytesError).
// 구워진 바이트 상한 BOARD_IMAGE_ENCODED_MAX_BYTES(2MB), base64 문자 수 상한
// BOARD_IMAGE_BASE64_MAX_CHARS — atob 전에 문자 수로 먼저 거른다.
//
// isPinned 는 관리자(admins 이메일 화이트리스트 — 웹 is_admin() 과 같은 기준)만 반영되고
// 비관리자가 보낸 값은 조용히 무시된다(웹 canPinBoardPost 와 같다).
//
// 오류: 400 검증 실패·잘못된 id · 403 "권한이 없어요." · 404 "글을 찾을 수 없어요."/"댓글을 찾을 수
// 없어요."/"답글을 달 댓글을 찾을 수 없어요." · 429 시간당 한도 · 500 저장·업로드 실패.
export type BoardWriteRequest =
  | { action: "post.create"; title: string; category: string; contentHtml: string; isPinned?: boolean }
  | { action: "post.update"; id: string; title: string; category: string; contentHtml: string; isPinned?: boolean }
  | { action: "post.delete"; id: string }
  // webpBase64: 데이터 URL 접두(`data:image/webp;base64,`) 없이 base64 본문만(avatar-upload 와 같다).
  | { action: "image"; webpBase64: string }
  // parentId 가 답글의 id 면 서버가 원 댓글로 접어 올린다(답글 깊이 1단계 — resolveBoardCommentParent).
  | { action: "comment.create"; postId: string; content: string; parentId?: string | null }
  | { action: "comment.update"; commentId: string; content: string }
  | { action: "comment.delete"; commentId: string };

// post.create → id 는 새 글의 id. post.update/post.delete/comment.* → id 는 그 **글**의 id
// (댓글을 고친 뒤 화면이 돌아갈 곳 — 웹 서버 액션이 돌려주는 값과 같다).
export type BoardWritePostResponse = { success: true; id: string };
// action:"image" → 본문에 넣을 공개 URL(`${boardImageOrigin}${userId}/${uuid}.webp`).
// 새니타이저는 이 접두사로 시작하는 <img src> 만 남기므로 다른 주소를 넣으면 저장 시 빠진다.
export type BoardWriteImageResponse = { success: true; url: string };
export type BoardWriteResponse = BoardWritePostResponse | BoardWriteImageResponse;

// 응답 판별 — 이미지면 url, 그 외는 id.
export function isBoardWriteImage(r: BoardWriteResponse): r is BoardWriteImageResponse {
  return "url" in r;
}

// ── notices-write (§6.7 #17 계열) ────────────────────────────────────────────
//
// 공지 **댓글** 쓰기. 웹 서버 액션 app/notices/actions.ts 의 createNoticeComment/
// updateNoticeComment/deleteNoticeComment 와 같은 규칙(core rules/notices.ts). 공지 원글의
// 작성·수정·삭제는 관리자 전용이라 앱에 없고(§5 — /notices/new·edit 는 AASA 제외) 여기에도 없다.
// notice_comments 는 RLS 로 직접 쓸 수도 있지만, 시간당 30건·비속어·닉네임 확정을 서버가
// 강제하려면 웹과 같은 규칙을 지나야 한다. 전부 로그인 필수(401).
//
// 오류: 400 검증 실패·잘못된 id · 403 "권한이 없어요." · 404 "댓글을 찾을 수 없어요." · 429 시간당
// 한도 · 500 저장 실패.
export type NoticesWriteRequest =
  | { action: "comment.create"; noticeId: string; content: string }
  | { action: "comment.update"; commentId: string; content: string }
  | { action: "comment.delete"; commentId: string };
// id 는 그 **공지**의 id(화면이 돌아갈 곳 — 웹 서버 액션과 같다).
export type NoticesWriteResponse = { success: true; id: string };

// ── suggestions (§6.7 #19) ───────────────────────────────────────────────────
//
// 건의게시판 **읽기와 쓰기 전부.** suggestions·suggestion_comments 는 anon/authenticated 의 SELECT
// 조차 회수돼 있어(schema.sql — 남의 비밀글 자리를 "비밀글입니다" 로 보여주려면 행을 서버가 읽고
// 마스킹해야 한다) 앱은 게시판·공지와 달리 목록·상세·댓글도 이 함수로 읽는다. 규칙은 core
// rules/suggestions.ts 하나 — 웹 lib/suggestions.ts·suggestions/actions.ts 와 같은 함수다.
//
// list·get·comments 는 비로그인도 부를 수 있다(getOptionalUser). 나머지는 로그인 필수(401).
// 관리자 판정은 board-write 와 같은 근거(admins 이메일 화이트리스트 — core isAdminEmail).
//
// **뷰어에 따라 달라지는 응답이다** — list 의 title/readable, get 의 canEdit/canDelete/canAnswer,
// comments 의 canEdit/canDelete 는 부른 사람 기준이다. 앱은 공개 캐시(['catalog', …])가 아니라
// 사용자 키(['me', userId, 'suggestions', …])에 두거나 persist 하지 않는다 — 다른 계정으로 로그인한
// 화면에 이전 사용자의 "내 글" 판정이 남으면 안 된다.
//
// get: 조회수는 서버가 웹 countSuggestionView 규칙대로 센다(글쓴이 본인·관리자 제외; 탈퇴한
// 회원의 글은 authorId null 이라 비로그인도 센다) — 앱이 따로 부를 RPC 는 없다(increment_suggestion_view
// 는 service_role 전용). 비밀글이면 { status: "forbidden" }, 없는 id(uuid 모양이 아닌 것 포함)면
// { status: "not_found" } — 둘 다 HTTP 200 이다(웹 fetchSuggestion 과 같은 세 갈래).
// comments: 원글 접근 권한을 서버가 다시 확인한다 — 없으면 404 "글을 찾을 수 없어요.", 비밀글이면
// 403 "권한이 없어요."(`{ error }`).
//
// 쓰기 오류: 400 검증 실패·잘못된 id · 403 "권한이 없어요."(남의 글·댓글, 비관리자 답변) / "잘못된
// 접근입니다."(볼 수 없는 비밀글에 댓글) · 404 "글을 찾을 수 없어요."/"댓글을 찾을 수 없어요." ·
// 429 시간당 한도(글 10·댓글 30, 웹과 같은 문장) · 500 저장 실패.
// isPinned 는 관리자만 반영되고 비관리자가 보낸 값은 조용히 무시된다(고정되는 글은 isSecret 이
// 강제로 꺼진다 — 웹 resolvePinAndSecret 와 같다).
export type SuggestionsRequest =
  // page 는 1부터. 없거나 모양이 틀리면 1.
  | { action: "list"; page?: number }
  | { action: "get"; id: string }
  | { action: "comments"; id: string }
  | { action: "create"; title: string; content: string; isSecret: boolean; isPinned?: boolean }
  | { action: "update"; id: string; title: string; content: string; isSecret: boolean; isPinned?: boolean }
  | { action: "delete"; id: string }
  // 관리자 전용.
  | { action: "answer"; id: string; answer: string }
  | { action: "comment.create"; suggestionId: string; content: string }
  | { action: "comment.update"; commentId: string; content: string }
  | { action: "comment.delete"; commentId: string };

// 목록 — 웹 fetchSuggestionPage 와 같은 모양. 볼 수 없는 비밀글은 title 이 이미 "비밀글입니다." 다.
export type SuggestionsListResponse = {
  items: SuggestionListItem[];
  pinnedItems: SuggestionListItem[];
  total: number;
  totalPages: number;
};
// 상세 — suggestion 안의 canEdit/canDelete 는 웹 SuggestionDetail 그대로고, 화면이 바로 읽게
// 바깥에도 canEdit/canDelete/canAnswer(관리자) 를 싣는다(같은 값).
export type SuggestionsGetResponse =
  | { status: "ok"; suggestion: SuggestionDetail; canEdit: boolean; canDelete: boolean; canAnswer: boolean }
  | { status: "not_found" }
  | { status: "forbidden" };
export type SuggestionsCommentsResponse = { items: SuggestionCommentItem[] };
// create → id 는 새 글의 id. update/delete/answer/comment.* → id 는 그 **글**의 id(화면이 돌아갈 곳 —
// 웹 서버 액션이 돌려주는 값과 같다; 웹 deleteSuggestion·deleteSuggestionComment 는 id 없이
// success 만 주지만 Edge 는 실어 준다 — 추가 필드).
export type SuggestionsWriteResponse = { success: true; id: string };
export type SuggestionsResponse =
  | SuggestionsListResponse
  | SuggestionsGetResponse
  | SuggestionsCommentsResponse
  | SuggestionsWriteResponse;

export function isSuggestionsList(r: SuggestionsResponse): r is SuggestionsListResponse {
  return "pinnedItems" in r;
}
export function isSuggestionsGet(r: SuggestionsResponse): r is SuggestionsGetResponse {
  return "status" in r;
}
export function isSuggestionsComments(r: SuggestionsResponse): r is SuggestionsCommentsResponse {
  return "items" in r && !("pinnedItems" in r);
}
export function isSuggestionsWrite(r: SuggestionsResponse): r is SuggestionsWriteResponse {
  return "success" in r;
}

// ── chat-send (§6.7 #20) ─────────────────────────────────────────────────────
//
// 채팅 전송. 웹 서버 액션 app/chat/actions.ts#sendChatMessage 와 같은 규칙(core rules/chat.ts —
// 300자·비속어·최소 간격 1.5초·같은 말 반복·10초에 5건). 읽기·Realtime 은 public read RLS 라 앱이
// supabase-js 로 직접 구독한다(§6.4) — 이 함수는 쓰기만. 로그인 필수(401 "로그인 후 이용할 수
// 있어요." — 웹 문장 "로그인 후 채팅에 참여할 수 있어요." 는 웹 어댑터가 낸다).
//
// 오류: 400 "메시지를 입력해주세요." / "메시지는 300자 이하로 입력해주세요." / 비속어 문구 ·
// 429 "너무 빨리 보내고 있어요. 잠시 후 다시 시도해주세요." / "같은 메시지를 반복해서 보낼 수 없어요." /
// "메시지를 너무 자주 보내고 있어요. 잠시 후 다시 시도해주세요." · 500 "전송에 실패했어요."
export type ChatSendRequest = { content: string };
// 방금 저장된 행 — 화면이 Realtime 이벤트보다 먼저 목록에 붙인다(웹 chat-panel 의 appendUnique 와
// 같은 용도; id 로 중복을 접는다).
export type ChatSendResponse = { message: ChatSentMessage };

// ── 맵 ──────────────────────────────────────────────────────────────────────

export type EdgeContracts = {
  "cbt-start": { request: CbtStartRequest; response: CbtStartResponse };
  "cbt-submit": { request: CbtSubmitRequest; response: CbtSubmitResponse };
  "explanations-get": { request: ExplanationsGetRequest; response: ExplanationsGetResponse };
  "membership-get": { request: MembershipGetRequest; response: MembershipGetResponse };
  "review-create": { request: ReviewCreateRequest; response: ReviewCreateResponse };
  "review-submit": { request: ReviewSubmitRequest; response: ReviewSubmitResponse };
  "review-history": { request: ReviewHistoryRequest; response: ReviewHistoryResponse };
  "review-guessed": { request: ReviewGuessedRequest; response: ReviewGuessedResponse };
  "review-due": { request: ReviewDueRequest; response: ReviewDueResponse };
  "review-prefs": { request: ReviewPrefsRequest; response: ReviewPrefsResponse };
  "mix-create": { request: MixCreateRequest; response: MixCreateResponse };
  "comments-write": { request: CommentsWriteRequest; response: CommentsWriteResponse };
  "avatar-upload": { request: AvatarUploadRequest; response: AvatarUploadResponse };
  "account-delete": { request: AccountDeleteRequest; response: AccountDeleteResponse };
  "ai-diagnose": { request: AiDiagnoseRequest; response: AiDiagnoseResponse };
  "diagnosis-request": { request: DiagnosisRequestRequest; response: DiagnosisRequestResponse };
  "diagnosis-collect": { request: DiagnosisCollectRequest; response: DiagnosisCollectResponse };
  "diagnosis-aggregate": { request: DiagnosisAggregateRequest; response: DiagnosisAggregateResponse };
  "board-write": { request: BoardWriteRequest; response: BoardWriteResponse };
  "notices-write": { request: NoticesWriteRequest; response: NoticesWriteResponse };
  suggestions: { request: SuggestionsRequest; response: SuggestionsResponse };
  "chat-send": { request: ChatSendRequest; response: ChatSendResponse };
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
  "review-guessed",
  "review-due",
  "review-prefs",
  "mix-create",
  "comments-write",
  "avatar-upload",
  "account-delete",
  "ai-diagnose",
  "diagnosis-request",
  "diagnosis-collect",
  "diagnosis-aggregate",
  "board-write",
  "notices-write",
  "suggestions",
  "chat-send",
] as const satisfies readonly EdgeName[];
