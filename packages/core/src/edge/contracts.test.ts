import { test } from "node:test";
import assert from "node:assert/strict";
import type { CbtSubmitSuccess } from "../rules/cbt-attempt";
import {
  toReviewResultItems,
  toReviewSolveItems,
  type ReviewHistoryEntry,
  type ReviewSessionView,
} from "../rules/review-session";
import type {
  MixHubIndex,
  MixOverview,
  MixSessionSummary,
  MixSessionWrongNote,
} from "../rules/mix-practice";
import type { ReviewPrefs, ReviewSubjectOption } from "../rules/review-preferences";
import type { DueReviewSummary } from "../rules/review-queue";
import { FREE_MEMBERSHIP } from "../membership";
import { DIAGNOSIS_RECHECK_SECONDS } from "../rules/diagnosis-batch";
import type { SessionSchedule } from "../review-queue";
import {
  EDGE_NAMES,
  isMixCreateHub,
  isMixCreateSession,
  isReviewDueSchedule,
  isReviewDueSession,
  isReviewDueSummary,
  isReviewHistoryList,
  type EdgeContracts,
  type EdgeErrorBody,
  type EdgeName,
  type EdgeRequest,
  type EdgeResponse,
} from "./contracts";

// 계약 타입의 컴파일 시점 검사. 각 Edge Function 이 지금 돌려주는 모양의 표본을 `satisfies`
// 로 고정한다 — rules/* 의 타입(CbtSubmitSuccess·ReviewResultItem·Membership …)이 바뀌어
// 계약과 어긋나면 이 파일이 typecheck 에서 깨진다(응답은 추가만, 삭제·의미 변경 금지).
// 런타임 assert 는 최소 — 이 파일의 본체는 타입이다.

// ── 이름 목록이 맵과 1:1 인지 ───────────────────────────────────────────────
type MissingFromList = Exclude<EdgeName, (typeof EDGE_NAMES)[number]>;
const _exhaustive: MissingFromList extends never ? true : never = true;
void _exhaustive;

// ── cbt-start / cbt-submit ──────────────────────────────────────────────────
({ paperId: "p1" }) satisfies EdgeRequest<"cbt-start">;
({ success: true, startedAt: "2026-09-15T03:00:00.000Z" }) satisfies EdgeResponse<"cbt-start">;

({ paperId: "p1", answers: [1, null, 3] }) satisfies EdgeRequest<"cbt-submit">;

// 규칙 결과 → Edge 직렬화(cbt-submit/index.ts 와 같은 변환). CbtSubmitSuccess 에 필드가
// 생기면 여기서 Omit/spread 가 함께 바뀌어야 하고, 빠지면 satisfies 가 깨진다.
const submitSuccess: CbtSubmitSuccess = {
  attemptId: "a1",
  score: 3,
  totalQuestions: 4,
  durationSeconds: 120,
  voidedQuestions: [4],
  questionResults: [{ question_number: 1, selected_choice: 1, is_correct: true }],
  diagnosisProgress: { attemptCount: 1, wrongCount: 1 },
};
const cbtSubmitResponse = {
  success: true as const,
  ...submitSuccess,
  diagnosisProgress: submitSuccess.diagnosisProgress ?? null,
} satisfies EdgeResponse<"cbt-submit">;

// ── explanations-get ────────────────────────────────────────────────────────
({ paperId: "p1" }) satisfies EdgeRequest<"explanations-get">;
({
  questions: [
    {
      questionNumber: 1,
      correctChoice: 2,
      choiceCount: 4,
      images: ["https://example/q1.png"],
      explanation: {
        keywordTitle: null,
        keywordExplanation: null,
        choiceExplanations: [{ choice: 1, text: "…", currentStatus: null, originalNote: null }],
        correctChoiceSummary: null,
        lawAmendmentNote: null,
        currentAnswerStatus: null,
        currentAnswerNote: null,
        lawBasisDate: null,
      },
    },
  ],
  totalCount: 20,
  hiddenCount: 18,
  hasFullAccess: false,
  loggedIn: true,
  lockReason: "free-quota",
  remainingToday: 0,
}) satisfies EdgeResponse<"explanations-get">;

// context:"wrong-note" 모드(§6.7 #7) — 요청은 optional 필드 추가, 응답은 explanationLocked·
// lockedQuestionNumbers 추가. 쿼터를 보지 않는 모드라 lockReason·remainingToday 는 언제나 null.
({ paperId: "p1", context: "wrong-note", questionNumbers: [3, 7] }) satisfies EdgeRequest<"explanations-get">;
const wrongNoteExplanations = {
  questions: [],
  totalCount: 2,
  hiddenCount: 2,
  hasFullAccess: false,
  loggedIn: true,
  lockReason: null,
  remainingToday: null,
  explanationLocked: true,
  lockedQuestionNumbers: [3, 7],
} satisfies EdgeResponse<"explanations-get">;

// ── membership-get ──────────────────────────────────────────────────────────
({}) satisfies EdgeRequest<"membership-get">;
({ membership: FREE_MEMBERSHIP, isAdmin: false, isPremium: false }) satisfies EdgeResponse<"membership-get">;

// ── review-* ────────────────────────────────────────────────────────────────
const view: ReviewSessionView = {
  id: "s1",
  scope: "subject",
  createdAt: "2026-09-15T03:00:00.000Z",
  subjectSlug: "korean",
  subjectName: "국어",
  total: 1,
  score: 1,
  submitted: true,
  items: [
    {
      position: 1,
      images: [],
      choiceCount: 4,
      selectedChoice: 2,
      correctChoice: 2,
      isCorrect: true,
      paperId: "p1",
      paperTitle: "2025 국가직 9급",
      questionNumber: 7,
      guessed: false,
    },
  ],
};

({ subjectSlug: "korean", onlyDue: true, limit: 20, strategy: "weighted", requestId: "r1" }) satisfies EdgeRequest<"review-create">;
({ paperIds: ["p1"] }) satisfies EdgeRequest<"review-create">;
({ items: [{ paperId: "p1", questionNumber: 7 }] }) satisfies EdgeRequest<"review-create">;
({ conceptId: "c1", concept: "행정행위" }) satisfies EdgeRequest<"review-create">;
({}) satisfies EdgeRequest<"review-create">;
// 풀이용 응답 — toReviewSolveItems 의 반환이 그대로 items 다(정답·출처 없음).
({
  sessionId: view.id,
  total: view.total,
  items: toReviewSolveItems(view),
  scope: view.scope,
  subjectSlug: view.subjectSlug,
  subjectName: view.subjectName,
}) satisfies EdgeResponse<"review-create">;

({ sessionId: "s1", answers: [2] }) satisfies EdgeRequest<"review-submit">;
const reviewSubmitResponse = {
  score: view.score ?? 0,
  total: view.total,
  items: toReviewResultItems(view),
  sessionId: view.id,
  scope: view.scope,
  subjectSlug: view.subjectSlug,
  subjectName: view.subjectName,
  createdAt: view.createdAt,
} satisfies EdgeResponse<"review-submit">;

({}) satisfies EdgeRequest<"review-history">;
({ scope: "due", subjectSlug: "korean", limit: 10 }) satisfies EdgeRequest<"review-history">;
({ sessionId: "s1", includeUnsubmitted: true }) satisfies EdgeRequest<"review-history">;
const historyEntry: ReviewHistoryEntry = {
  sessionId: "s1",
  scope: "subject",
  subjectSlug: "korean",
  subjectName: "국어",
  total: 1,
  score: 1,
  createdAt: view.createdAt,
  submittedAt: "2026-09-15T03:10:00.000Z",
};
const historyList = { sessions: [historyEntry] } satisfies EdgeResponse<"review-history">;
const historyDetail = {
  ...reviewSubmitResponse,
  score: null,
  submitted: false,
} satisfies EdgeResponse<"review-history">;

// view:"mix-note"(§6.7 #10) — 요청은 optional 필드 추가, 응답은 상세 그대로 + mixNote.
// mixNote 는 규칙 getMixSessionWrongNote 의 반환(MixSessionWrongNote)을 그대로 실은 것이라,
// 규칙 쪽 타입이 바뀌면 여기서 함께 깨진다(웹 mix 기록 페이지와 앱이 같은 값을 그린다).
({ sessionId: "s1", view: "mix-note" }) satisfies EdgeRequest<"review-history">;
const mixNote: MixSessionWrongNote = {
  session: { id: "s1", title: "9월 5일 섞어풀기", createdAt: view.createdAt, score: 1, total: 2 },
  subject: { id: "sub1", slug: "korean", name: "국어", display_order: 1 },
  questions: [
    {
      position: 0,
      paperId: "p1",
      paperTitle: "2025 국가직 9급",
      paperLevel: "9급",
      examTypeName: "국가직",
      questionNumber: 7,
      selectedChoice: 3,
      correctChoice: 2,
      isCorrect: false,
      choiceCount: 4,
      images: ["https://example/q7.png"],
      explanation: null,
      explanationLocked: true,
      memo: "행정행위 개념 다시",
      pinned: true,
      wrongCount: 2,
      resolved: false,
    },
  ],
  wrongCount: 1,
  resolvedCount: 0,
};
const historyMixNote = {
  ...reviewSubmitResponse,
  submitted: true,
  mixNote,
} satisfies EdgeResponse<"review-history">;

// 목록 항목의 mix 추가 필드(§6.7 #14 / §12-4 "믹스 기록 목록") — 규칙 listMixSessions 의
// MixSessionSummary 에서 세 값을 그대로 가져온다. scope:"mix" + subjectSlug 일 때만 실린다.
const mixSummary: MixSessionSummary = {
  id: "s1",
  title: "9월 5일 섞어풀기 (2)",
  createdAt: view.createdAt,
  score: 8,
  total: 10,
  wrongCount: 2,
  resolvedCount: 1,
};
const historyMixList = {
  sessions: [
    {
      ...historyEntry,
      title: mixSummary.title,
      wrongCount: mixSummary.wrongCount,
      resolvedCount: mixSummary.resolvedCount,
    },
  ],
} satisfies EdgeResponse<"review-history">;

// ── review-guessed (§6.7 #11) ───────────────────────────────────────────────
({ sessionId: "s1", position: 3 }) satisfies EdgeRequest<"review-guessed">;
({ ok: true }) satisfies EdgeResponse<"review-guessed">;

// ── review-due (§6.7 #12) ───────────────────────────────────────────────────
({ action: "summary" }) satisfies EdgeRequest<"review-due">;
({ action: "create", requestId: "r1" }) satisfies EdgeRequest<"review-due">;
({ action: "extra" }) satisfies EdgeRequest<"review-due">;
({ action: "schedule", sessionId: "s1" }) satisfies EdgeRequest<"review-due">;
({ action: "nudge" }) satisfies EdgeRequest<"review-due">;

// 요약은 규칙 getDueReviewSummary 의 반환 그대로다 — DueReviewSummary 에 필드가 생기면
// 여기서 함께 깨진다(웹 배너와 앱 카드가 같은 값을 그린다는 뜻).
const dueSummary: DueReviewSummary = {
  todayCount: 12,
  deferredCount: 3,
  newCount: 4,
  pendingTotal: 40,
  suspendedTotal: 1,
  overdueTotal: 11,
  relearnCount: 2,
  dailyLimit: 20,
  subjects: [{ subjectId: "sub1", name: "국어", count: 7 }],
  forecast: [
    { offset: 0, count: 12 },
    { offset: 1, count: 5 },
  ],
  nextDueOffset: null,
};
const reviewDueSummary = dueSummary satisfies EdgeResponse<"review-due">;

// 세션 응답은 review-create 와 같은 모양 + resumed.
const reviewDueSession = {
  sessionId: view.id,
  total: view.total,
  items: toReviewSolveItems(view),
  scope: view.scope,
  subjectSlug: view.subjectSlug,
  subjectName: view.subjectName,
  resumed: true,
} satisfies EdgeResponse<"review-due">;

const sessionSchedule: SessionSchedule = {
  items: [{ position: 0, paperTitle: "2025 국가직 9급", questionNumber: 7, dueInDays: 3 }],
  forecast: [{ offset: 0, count: 12 }],
};
const reviewDueSchedule = { schedule: sessionSchedule } satisfies EdgeResponse<"review-due">;
const reviewDueNudge = {
  todayCount: 12,
  subjects: [{ name: "국어", count: 7 }],
} satisfies EdgeResponse<"review-due">;

// ── review-prefs (§6.7 #13) ─────────────────────────────────────────────────
({}) satisfies EdgeRequest<"review-prefs">;
({ action: "get" }) satisfies EdgeRequest<"review-prefs">;
({ action: "daily-limit", limit: 40 }) satisfies EdgeRequest<"review-prefs">;
({ action: "pause", subjectId: "sub1", paused: true }) satisfies EdgeRequest<"review-prefs">;
({ action: "diagnosis-pause", subjectId: "sub1", paused: false }) satisfies EdgeRequest<"review-prefs">;
({ action: "study-phase", phase: "settling" }) satisfies EdgeRequest<"review-prefs">;
({ action: "spread" }) satisfies EdgeRequest<"review-prefs">;
({ action: "restore" }) satisfies EdgeRequest<"review-prefs">;

const subjectOption: ReviewSubjectOption = {
  id: "sub1",
  name: "국어",
  paused: false,
  scheduledCount: 12,
  pendingCount: 40,
};
// Set 은 JSON 으로 나가지 않는다 — Edge 가 배열로 펴서 보낸다(규칙 ReviewPrefs 와 다른 점).
const prefs: ReviewPrefs = { pausedSubjectIds: new Set(["sub2"]), dailyLimit: 20 };
const reviewPrefsGet = {
  premium: true,
  dailyLimit: prefs.dailyLimit,
  pausedSubjectIds: [...prefs.pausedSubjectIds],
  diagnosisPausedSubjectIds: [],
  studyPhase: "settling",
  subjects: [subjectOption],
} satisfies EdgeResponse<"review-prefs">;
const reviewPrefsSpread = {
  premium: true,
  dailyLimit: 20,
  pausedSubjectIds: [],
  diagnosisPausedSubjectIds: [],
  studyPhase: null,
  spreadCount: 37,
} satisfies EdgeResponse<"review-prefs">;

// ── mix-create (§6.7 #14) ───────────────────────────────────────────────────
({ action: "hub" }) satisfies EdgeRequest<"mix-create">;
({ action: "overview", subjectSlug: "korean" }) satisfies EdgeRequest<"mix-create">;
({
  action: "create",
  subjectSlug: "korean",
  levels: ["9급"],
  yearRange: { from: 2020, to: 2025 },
  limit: 20,
  requestId: "r1",
}) satisfies EdgeRequest<"mix-create">;
({ action: "retry", sessionId: "s1" }) satisfies EdgeRequest<"mix-create">;

const mixHub: MixHubIndex = {
  tiers: [{ key: "9급", approx: false, count: 1200 }],
  subjects: [{ slug: "korean", name: "국어", count: 1200, byTier: { "9급": 1200 } }],
  unit: "question",
};
const mixCreateHub = mixHub satisfies EdgeResponse<"mix-create">;
const mixOverview: MixOverview = {
  subject: { id: "sub1", slug: "korean", name: "국어", display_order: 1 },
  questionCount: 1200,
  paperCount: 60,
  examTypeNames: ["국가직", "지방직"],
  levelGroups: [{ key: "9급", count: 1200, approx: false }],
  cells: [{ level: "9급", year: 2025, count: 40 }],
  minYear: 2013,
  maxYear: 2025,
};
const mixCreateOverview = mixOverview satisfies EdgeResponse<"mix-create">;
const mixCreateSession = {
  sessionId: view.id,
  total: view.total,
  items: toReviewSolveItems(view),
  scope: "mix",
  subjectSlug: "korean",
  subjectName: "국어",
  unseenCount: 18,
  coveredAll: false,
} satisfies EdgeResponse<"mix-create">;

// ── comments-write / account-delete ─────────────────────────────────────────
({ action: "create", paperId: "p1", content: "…", parentId: null }) satisfies EdgeRequest<"comments-write">;
({ action: "update", commentId: "c1", content: "…" }) satisfies EdgeRequest<"comments-write">;
({ action: "delete", commentId: "c1" }) satisfies EdgeRequest<"comments-write">;
({ ok: true }) satisfies EdgeResponse<"comments-write">;
({}) satisfies EdgeRequest<"account-delete">;
({ ok: true }) satisfies EdgeResponse<"account-delete">;

// ── ai-diagnose ─────────────────────────────────────────────────────────────
({}) satisfies EdgeRequest<"ai-diagnose">;
({
  report: {
    summary: "…",
    weakConcepts: [{ concept: "행정행위", subject: "행정법", subjectSlug: "admin-law", wrongCount: 3, resolvedCount: 1 }],
    subjectTrends: [{ subject: "행정법", trend: "up", note: "…" }],
  },
  date: "2026-09-15",
  cached: false,
}) satisfies EdgeResponse<"ai-diagnose">;

// ── diagnosis-request / diagnosis-collect / diagnosis-aggregate (§6.7 #21) ──
({}) satisfies EdgeRequest<"diagnosis-request">;
({ selectedConcepts: [{ conceptId: null, concept: "행정행위" }] }) satisfies EdgeRequest<"diagnosis-request">;
({
  status: "pending",
  date: "2026-09-16",
  nextDate: "2026-09-23",
  selectedCount: 3,
  // 요청한 그 자리에서 배치를 제출한다(크론을 기다리지 않는다). 아래 네 필드는 추가분이다.
  submitted: true,
  generating: true,
  submitError: null,
  recheckSeconds: DIAGNOSIS_RECHECK_SECONDS,
}) satisfies EdgeResponse<"diagnosis-request">;

({}) satisfies EdgeRequest<"diagnosis-collect">;
({
  status: "pending",
  date: "2026-09-16",
  requestedAt: "2026-09-16T03:00:00.000Z",
  conceptCount: 3,
  error: null,
  recheckSeconds: DIAGNOSIS_RECHECK_SECONDS,
}) satisfies EdgeResponse<"diagnosis-collect">;
({
  status: "none",
  date: null,
  requestedAt: null,
  conceptCount: 0,
  error: null,
  recheckSeconds: DIAGNOSIS_RECHECK_SECONDS,
}) satisfies EdgeResponse<"diagnosis-collect">;

// 폴링 간격을 서버가 정한다는 계약. 앱이 이보다 자주 불러도 서버는 Anthropic 을 두드리지
// 않고 pending 만 돌려주므로, 이 값이 0 이 되면 폴링이 그대로 레이트리밋 사고가 된다.
test("재확인 간격은 양수다", () => {
  assert.ok(DIAGNOSIS_RECHECK_SECONDS > 0);
});

({}) satisfies EdgeRequest<"diagnosis-aggregate">;
({ days: null }) satisfies EdgeRequest<"diagnosis-aggregate">;
({
  window: { days: 7, widened: false },
  subjects: [{ name: "행정법", slug: "admin-law" }],
  concepts: [
    {
      concept: "행정행위",
      conceptId: "c1",
      subject: "행정법",
      subjectSlug: "admin-law",
      wrongCount: 3,
      accuracyPct: 40,
      scoreGainPct: 7.5,
      corpusCount: 12,
    },
  ],
  bySubject: [
    {
      subject: "행정법",
      subjectSlug: "admin-law",
      totalWrong: 3,
      concepts: [
        {
          concept: "행정행위",
          conceptId: "c1",
          subject: "행정법",
          subjectSlug: "admin-law",
          wrongCount: 3,
          accuracyPct: 40,
          scoreGainPct: 7.5,
          corpusCount: 12,
        },
      ],
    },
  ],
  analysisDays: 7,
  picker: [
    {
      key: "c1",
      concept: "행정행위",
      conceptId: "c1",
      subject: "행정법",
      subjectSlug: "admin-law",
      wrongCount: 3,
      accuracyPct: 40,
      scoreGainPct: 7.5,
      recommended: true,
    },
  ],
  cycle: { requestedThisCycle: false, status: null, date: null, nextDate: null },
  generating: null,
  eligibility: { eligible: true, attemptCount: 3, wrongCount: 12 },
}) satisfies EdgeResponse<"diagnosis-aggregate">;

// 리포트 본문은 이 두 응답에 없다 — 앱이 ai_diagnoses.report 를 RLS 로 직접 읽는다(§6.7 #21).

// ── 오류 본문 ───────────────────────────────────────────────────────────────
({ error: "로그인 후 이용할 수 있어요." }) satisfies EdgeErrorBody;

// 맵의 모든 항목이 request/response 를 갖는지(구조 고정).
type _EveryEntry = { [N in EdgeName]: EdgeContracts[N] extends { request: unknown; response: unknown } ? true : never };
const _every: _EveryEntry[EdgeName] = true;
void _every;

test("EDGE_NAMES 는 배포된 함수 17개", () => {
  assert.equal(EDGE_NAMES.length, 17);
  assert.equal(new Set(EDGE_NAMES).size, EDGE_NAMES.length);
});

test("review-due 응답 판별이 네 액션을 겹치지 않게 가른다", () => {
  assert.equal(isReviewDueSummary(reviewDueSummary), true);
  assert.equal(isReviewDueSession(reviewDueSummary), false);
  assert.equal(isReviewDueSession(reviewDueSession), true);
  assert.equal(isReviewDueSchedule(reviewDueSchedule), true);
  // 넛지는 셋 중 어디에도 걸리지 않는다(todayCount 는 요약과 겹치지만 forecast 가 없다).
  for (const guard of [isReviewDueSummary, isReviewDueSession, isReviewDueSchedule]) {
    assert.equal(guard(reviewDueNudge), false);
  }
});

test("mix-create 응답 판별 — 허브·요약·세션", () => {
  assert.equal(isMixCreateHub(mixCreateHub), true);
  assert.equal(isMixCreateSession(mixCreateSession), true);
  assert.equal(isMixCreateHub(mixCreateOverview), false);
  assert.equal(isMixCreateSession(mixCreateOverview), false);
});

test("review-prefs 는 액션과 무관하게 같은 모양 — 쓰기도 갱신된 설정을 싣는다", () => {
  for (const key of ["premium", "dailyLimit", "pausedSubjectIds", "diagnosisPausedSubjectIds", "studyPhase"]) {
    assert.ok(key in reviewPrefsGet, `get 응답에 ${key} 가 없다`);
    assert.ok(key in reviewPrefsSpread, `spread 응답에 ${key} 가 없다`);
  }
  // Set 은 그대로 직렬화되지 않는다 — 배열이어야 앱이 읽는다.
  assert.deepEqual(reviewPrefsGet.pausedSubjectIds, ["sub2"]);
  // 과목 목록은 get 에서만(쓰기 응답에는 없다 — 매 토글마다 전체 집계를 돌리지 않는다).
  assert.equal("subjects" in reviewPrefsSpread, false);
});

test("mix 기록 목록은 기존 목록 항목의 상위집합이다(추가 필드)", () => {
  assert.equal(isReviewHistoryList(historyMixList), true);
  const [entry] = historyMixList.sessions;
  for (const key of Object.keys(historyEntry)) {
    assert.ok(key in entry, `mix 목록 항목에 기존 필드 ${key} 가 없다`);
  }
  assert.equal(entry.wrongCount, 2);
  assert.equal(entry.resolvedCount, 1);
  // 옛 응답(추가 필드 없음)도 그대로 계약을 만족한다 — 옛 앱이 깨지지 않는다.
  assert.equal(isReviewHistoryList(historyList), true);
});

test("isReviewHistoryList 가 목록/상세를 가른다", () => {
  assert.equal(isReviewHistoryList(historyList), true);
  assert.equal(isReviewHistoryList(historyDetail), false);
});

test("wrong-note 모드 표본은 쿼터 필드를 null 로 둔다", () => {
  assert.equal(wrongNoteExplanations.lockReason, null);
  assert.equal(wrongNoteExplanations.remainingToday, null);
  assert.equal(wrongNoteExplanations.explanationLocked, true);
  assert.equal(wrongNoteExplanations.questions.length, 0, "잠긴 문항의 본문은 응답에 없다");
});

test("mix-note 표본은 상세 응답의 상위집합이다(추가 필드)", () => {
  assert.equal(isReviewHistoryList(historyMixNote), false);
  assert.equal(historyMixNote.sessionId, historyDetail.sessionId);
  assert.equal(historyMixNote.mixNote.questions[0].explanationLocked, true);
  // 상세 필드가 그대로 있어야 옛 앱이 같은 응답을 읽을 수 있다.
  for (const key of Object.keys(historyDetail)) {
    assert.ok(key in historyMixNote, `mix-note 응답에 상세 필드 ${key} 가 없다`);
  }
});

test("cbt-submit 직렬화 표본은 diagnosisProgress 를 null 로 떨어뜨린다", () => {
  const { diagnosisProgress: _dp, ...rest } = submitSuccess;
  void _dp;
  const withoutProgress = { success: true as const, ...rest, diagnosisProgress: null } satisfies EdgeResponse<"cbt-submit">;
  assert.equal(withoutProgress.diagnosisProgress, null);
  assert.deepEqual(cbtSubmitResponse.diagnosisProgress, { attemptCount: 1, wrongCount: 1 });
});
