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
import type { ReviewPrefs, ReviewSubjectOption } from "../rules/review-preferences";
import type { DueReviewSummary } from "../rules/review-queue";
import type {
  ReviewHistoryEntry,
  ReviewResultItem,
  ReviewSolveItem,
} from "../rules/review-session";
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
export type ReviewHistoryRequest = ReviewHistoryListRequest | ReviewHistoryDetailRequest;

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
export type ReviewHistoryResponse = ReviewHistoryListResponse | ReviewHistoryDetailResponse;

// 응답 판별 — 목록이면 sessions, 상세면 sessionId.
export function isReviewHistoryList(r: ReviewHistoryResponse): r is ReviewHistoryListResponse {
  return "sessions" in r;
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
// 웹에서도 무료다(§8.3 첫 줄). hub·overview 는 로그인과 무관한 공개 통계다.
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
  "review-guessed": { request: ReviewGuessedRequest; response: ReviewGuessedResponse };
  "review-due": { request: ReviewDueRequest; response: ReviewDueResponse };
  "review-prefs": { request: ReviewPrefsRequest; response: ReviewPrefsResponse };
  "mix-create": { request: MixCreateRequest; response: MixCreateResponse };
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
  "review-guessed",
  "review-due",
  "review-prefs",
  "mix-create",
  "comments-write",
  "account-delete",
  "ai-diagnose",
] as const satisfies readonly EdgeName[];
