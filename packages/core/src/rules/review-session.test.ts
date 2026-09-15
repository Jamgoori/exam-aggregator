import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient, type Row } from "../test-support/fake-supabase";
import {
  createReviewSessionFromItems,
  submitReviewSessionForUser,
  toReviewSolveItems,
  getReviewSessionView,
} from "./review-session";

// 복습·섞어풀기 세션 규칙의 계약 테스트. 여기서 지키는 것(설계서 §6.6):
//  · 채점은 세션을 **먼저 선점**한 요청만 한다 — 같은 세션을 두 번 제출하면 두 번째는
//    "이미 채점된 세션이에요." 를 받고 상태·출석이 두 번 기록되지 않는다.
//  · 같은 requestId 로 두 번 만들면 세션은 하나다(유니크 인덱스 23505 → 기존 세션 반환).
//    requestId 가 없으면(웹) request_id 를 넣지 않는다.
//  · 기출 섞어풀기(scope 'mix') 채점은 source 'mix', 나머지는 'review' 로 기록된다.
//  · 풀이용 응답(toReviewSolveItems)에는 paperId/correctChoice 가 없다.

const USER = "user-1";
const PAPER = "paper-1";
const NOW = new Date("2027-09-15T03:00:00Z");
// 세션을 만든 지 충분히 지난 뒤 제출한 것으로 잡아 출석 경로까지 검사한다.
const CREATED = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();

function question(q: number): Row {
  return {
    id: `${PAPER}:${q}`,
    paper_id: PAPER,
    question_number: q,
    choice_count: 4,
    question_images: [{ order_index: 0, image_path: `${PAPER}/${q}.webp` }],
  };
}

function makeDb(opts: { scope?: string; submittedAt?: string | null } = {}) {
  const attendance: Row[] = [];
  return new FakeSupabase(
    {
      review_sessions: [
        {
          id: "s1",
          user_id: USER,
          subject_id: null,
          scope: opts.scope ?? "subject",
          total_questions: 3,
          score: null,
          created_at: CREATED,
          submitted_at: opts.submittedAt ?? null,
        },
      ],
      review_session_items: [1, 2, 3].map((q, i) => ({
        id: `i${q}`,
        session_id: "s1",
        paper_id: PAPER,
        question_number: q,
        position: i,
        selected_choice: null,
        is_correct: null,
      })),
      paper_answers: [{ paper_id: PAPER, answers: [1, 2, 3], voided_questions: [] }],
      exam_papers: [
        {
          id: PAPER,
          subject_id: "korean",
          exam_type_id: "gukga",
          year: 2026,
          round: 1,
          level: "9",
          track: null,
          title: "2026 국가직 9급 국어",
          choice_count: 4,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
      questions: [question(1), question(2), question(3)],
      subjects: [],
      user_question_status: [],
      srs_reviews: [],
      attendance_calls: attendance,
    },
    {
      primaryKeys: {
        review_sessions: ["user_id", "request_id"],
        review_session_items: ["id"],
        user_question_status: ["user_id", "paper_id", "question_number"],
      },
      rpc: {
        record_attendance_day: (args, db) => {
          db.tables.attendance_calls.push(args);
          return 1;
        },
      },
    },
  );
}

const quiet = { now: NOW, questionStatus: { fuzz: () => 0.5 } };

test("채점: 정답 대조·점수·상태·출석이 한 번씩 기록되고 채점 뷰가 돌아온다", async () => {
  const db = makeDb();
  const client = asClient(db);
  const result = await submitReviewSessionForUser(client, client, USER, "s1", [1, 2, 4], quiet);

  assert.equal(result.error, undefined);
  assert.equal(result.view?.score, 2);
  assert.equal(result.view?.submitted, true);
  assert.deepEqual(
    result.view?.items.map((it) => [it.isCorrect, it.correctChoice, it.selectedChoice]),
    [
      [true, 1, 1],
      [true, 2, 2],
      [false, 3, 4],
    ],
  );

  const session = db.rowsOf("review_sessions")[0];
  assert.equal(session.score, 2);
  assert.equal(session.submitted_at, NOW.toISOString());
  // 상태 행은 문항마다 하나, source 는 review.
  const statuses = db.rowsOf("user_question_status");
  assert.equal(statuses.length, 3);
  assert.ok(statuses.every((r) => r.source === "review"));
  assert.equal(statuses.find((r) => r.question_number === 3)?.wrong_count, 1);
  // 출석은 답을 고른 3문항으로 한 번.
  assert.equal(db.rowsOf("attendance_calls").length, 1);
});

test("선점: 같은 세션을 두 번 제출하면 두 번째는 거절되고 아무것도 두 번 기록되지 않는다", async () => {
  const db = makeDb();
  const client = asClient(db);
  const first = await submitReviewSessionForUser(client, client, USER, "s1", [1, 2, 3], quiet);
  assert.equal(first.error, undefined);

  const writesAfterFirst = db.writes.length;
  const second = await submitReviewSessionForUser(client, client, USER, "s1", [1, 2, 3], quiet);
  assert.equal(second.error, "이미 채점된 세션이에요.");
  assert.equal(second.status, 400);
  assert.equal(second.view, undefined);
  // 두 번째 요청은 선점 update(0행) 말고는 아무것도 쓰지 않는다.
  const extra = db.writes.slice(writesAfterFirst);
  assert.deepEqual(
    extra.map((w) => [w.table, w.op, w.matched.length]),
    [["review_sessions", "update", 0]],
  );
  assert.equal(db.rowsOf("attendance_calls").length, 1);
  assert.equal(db.rowsOf("user_question_status").length, 3);
});

test("선점은 채점 전에 일어난다 — 이미 submitted_at 이 있는 세션은 정답 조회조차 하지 않는다", async () => {
  const db = makeDb({ submittedAt: "2027-09-15T02:00:00Z" });
  const client = asClient(db);
  const result = await submitReviewSessionForUser(client, client, USER, "s1", [1, 2, 3], quiet);
  assert.equal(result.error, "이미 채점된 세션이에요.");
  assert.ok(!db.reads.includes("paper_answers"));
  assert.equal(db.rowsOf("user_question_status").length, 0);
});

test("남의 세션·없는 세션은 '세션을 찾을 수 없어요.'(404)", async () => {
  const db = makeDb();
  const client = asClient(db);
  const other = await submitReviewSessionForUser(client, client, "user-2", "s1", [1], quiet);
  assert.equal(other.error, "세션을 찾을 수 없어요.");
  assert.equal(other.status, 404);
  const missing = await submitReviewSessionForUser(client, client, USER, "nope", [1], quiet);
  assert.equal(missing.error, "세션을 찾을 수 없어요.");
  // 거절된 요청은 세션을 건드리지 않는다.
  assert.equal(db.rowsOf("review_sessions")[0].submitted_at, null);
});

test("문항이 없는 세션은 선점을 되돌려 다시 제출할 수 있게 한다", async () => {
  const db = makeDb();
  db.tables.review_session_items = [];
  const client = asClient(db);
  const result = await submitReviewSessionForUser(client, client, USER, "s1", [], quiet);
  assert.equal(result.error, "세션에 문항이 없어요.");
  assert.equal(db.rowsOf("review_sessions")[0].submitted_at, null);
});

test("기출 섞어풀기(scope 'mix') 채점은 source 'mix' 로, 그 외는 'review' 로 남는다", async () => {
  for (const [scope, source] of [
    ["mix", "mix"],
    ["subject", "review"],
    ["due", "review"],
    ["all", "review"],
  ] as const) {
    const db = makeDb({ scope });
    const client = asClient(db);
    await submitReviewSessionForUser(client, client, USER, "s1", [1, 2, 3], quiet);
    const statuses = db.rowsOf("user_question_status");
    assert.equal(statuses.length, 3, scope);
    assert.ok(
      statuses.every((r) => r.source === source),
      `${scope} → ${source} 이어야 한다`,
    );
  }
});

// ── requestId 멱등 ─────────────────────────────────────────────────────────────

const ITEMS = [
  { paperId: PAPER, questionNumber: 1 },
  { paperId: PAPER, questionNumber: 2 },
];

test("같은 requestId 로 두 번 만들면 세션은 하나이고 같은 id 가 돌아온다", async () => {
  const db = makeDb();
  db.tables.review_sessions = [];
  db.tables.review_session_items = [];
  const admin = asClient(db);

  const first = await createReviewSessionFromItems(admin, USER, ITEMS, 50, {
    keepOrder: true,
    requestId: "req-1",
  });
  assert.ok(first.sessionId);
  const second = await createReviewSessionFromItems(admin, USER, ITEMS, 50, {
    keepOrder: true,
    requestId: "req-1",
  });
  assert.equal(second.error, undefined);
  assert.equal(second.sessionId, first.sessionId);

  assert.equal(db.rowsOf("review_sessions").length, 1);
  assert.equal(db.rowsOf("review_sessions")[0].request_id, "req-1");
  // 문항도 한 벌만.
  assert.equal(db.rowsOf("review_session_items").length, 2);
});

test("다른 requestId 는 다른 세션이고, 다른 사용자의 같은 requestId 도 다른 세션이다", async () => {
  const db = makeDb();
  db.tables.review_sessions = [];
  db.tables.review_session_items = [];
  const admin = asClient(db);

  const a = await createReviewSessionFromItems(admin, USER, ITEMS, 50, { requestId: "req-a" });
  const b = await createReviewSessionFromItems(admin, USER, ITEMS, 50, { requestId: "req-b" });
  const c = await createReviewSessionFromItems(admin, "user-2", ITEMS, 50, { requestId: "req-a" });
  assert.equal(new Set([a.sessionId, b.sessionId, c.sessionId]).size, 3);
});

test("requestId 가 없으면(웹) request_id 를 넣지 않고 매번 새 세션이다", async () => {
  const db = makeDb();
  db.tables.review_sessions = [];
  db.tables.review_session_items = [];
  const admin = asClient(db);

  const a = await createReviewSessionFromItems(admin, USER, ITEMS, 50);
  const b = await createReviewSessionFromItems(admin, USER, ITEMS, 50);
  assert.notEqual(a.sessionId, b.sessionId);
  const inserted = db.writes.filter((w) => w.table === "review_sessions" && w.op === "insert");
  assert.equal(inserted.length, 2);
  for (const w of inserted) assert.ok(!("request_id" in w.values[0]));
});

// ── 풀이용 응답 ─────────────────────────────────────────────────────────────────

test("풀이용 응답(review-create)에는 paperId·correctChoice·출처가 없다", async () => {
  const db = makeDb();
  const client = asClient(db);
  const view = await getReviewSessionView(client, client, USER, "s1");
  assert.ok(view);
  const items = toReviewSolveItems(view);
  assert.equal(items.length, 3);
  for (const it of items) {
    assert.deepEqual(Object.keys(it).sort(), ["choiceCount", "images", "position"]);
    assert.ok(it.images.length > 0);
  }
  // 채점이 끝난 뷰를 넘겨도 같은 모양이다 — 정답이 있는 뷰가 실수로 들어와도 새지 않는다.
  await submitReviewSessionForUser(client, client, USER, "s1", [1, 2, 3], quiet);
  const graded = await getReviewSessionView(client, client, USER, "s1");
  assert.ok(graded?.items[0].correctChoice != null);
  for (const it of toReviewSolveItems(graded!)) {
    assert.ok(!("correctChoice" in it));
    assert.ok(!("paperId" in it));
    assert.ok(!("paperTitle" in it));
    assert.ok(!("questionNumber" in it));
  }
});
