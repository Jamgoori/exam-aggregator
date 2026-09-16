import { test } from "node:test";
import assert from "node:assert/strict";
import type { CbtSubmitSuccess } from "../rules/cbt-attempt";
import {
  toReviewResultItems,
  toReviewSolveItems,
  type ReviewHistoryEntry,
  type ReviewSessionView,
} from "../rules/review-session";
import type { MixSessionWrongNote } from "../rules/mix-practice";
import { FREE_MEMBERSHIP } from "../membership";
import {
  EDGE_NAMES,
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

// ── 오류 본문 ───────────────────────────────────────────────────────────────
({ error: "로그인 후 이용할 수 있어요." }) satisfies EdgeErrorBody;

// 맵의 모든 항목이 request/response 를 갖는지(구조 고정).
type _EveryEntry = { [N in EdgeName]: EdgeContracts[N] extends { request: unknown; response: unknown } ? true : never };
const _every: _EveryEntry[EdgeName] = true;
void _every;

test("EDGE_NAMES 는 배포된 함수 10개", () => {
  assert.equal(EDGE_NAMES.length, 10);
  assert.equal(new Set(EDGE_NAMES).size, EDGE_NAMES.length);
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
