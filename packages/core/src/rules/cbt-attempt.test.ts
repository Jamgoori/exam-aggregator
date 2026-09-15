import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient, type Row } from "../test-support/fake-supabase";
import { startCbtAttempt, submitCbtAttempt, isCbtRuleError, MIN_ATTEMPT_SECONDS } from "./cbt-attempt";
import { ATTENDANCE_MIN_QUESTIONS } from "../attendance";

// CBT 채점 규칙의 계약 테스트. 여기서 지키는 것(설계서 §6.6 "CBT 이중 제출"):
//  · 시작 행이 없으면 채점하지 않는다.
//  · 시작 행은 채점 **전에** 회수한다 — 같은 시작으로 두 번 제출하면 두 번째는 거절.
//  · 최소 응시시간에 걸리면 거절하되 시작 행은 원래 시각 그대로 되돌려 재시도가 된다.
//  · voided 문항은 무조건 정답, 출석 문항 수는 답을 고른 문항만 센다.

const USER = "user-1";
const PAPER = "paper-1";
const STARTED = new Date("2026-09-15T03:00:00Z");
// 출석이 열려 있는 시점(전면 무료 기간 FREE_UNTIL 이후)으로 잡아 출석 경로까지 검사한다.
const OPEN_START = new Date("2027-09-15T03:00:00Z");

function afterSeconds(from: Date, seconds: number): Date {
  return new Date(from.getTime() + seconds * 1000);
}

function makeDb(opts: { startedAt?: Date | null; answers?: number[]; voided?: number[] } = {}) {
  const startedAt = opts.startedAt === undefined ? STARTED : opts.startedAt;
  const attendance: Row[] = [];
  return new FakeSupabase(
    {
      paper_answers: [
        {
          paper_id: PAPER,
          answers: opts.answers ?? [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4],
          voided_questions: opts.voided ?? [],
        },
      ],
      cbt_attempt_starts: startedAt
        ? [{ user_id: USER, paper_id: PAPER, started_at: startedAt.toISOString() }]
        : [],
      cbt_attempts: [],
      cbt_attempt_answers: [],
      user_question_status: [],
      attendance_calls: attendance,
    },
    {
      primaryKeys: {
        cbt_attempt_starts: ["user_id", "paper_id"],
        user_question_status: ["user_id", "paper_id", "question_number"],
      },
      rpc: {
        record_attendance_day: (args, db) => {
          db.tables.attendance_calls.push(args);
          return 1;
        },
        start_trial_if_eligible: () => [],
      },
    },
  );
}

const quiet = { questionStatus: { fuzz: () => 0.5 } };

test("startCbtAttempt 는 시작 시각을 기록하고 그대로 돌려준다(재시작은 덮어쓴다)", async () => {
  const db = makeDb({ startedAt: null });
  const first = await startCbtAttempt(asClient(db), USER, PAPER, STARTED);
  assert.ok(!isCbtRuleError(first));
  assert.equal(first.startedAt, STARTED.toISOString());

  const later = afterSeconds(STARTED, 30);
  const second = await startCbtAttempt(asClient(db), USER, PAPER, later);
  assert.ok(!isCbtRuleError(second));
  assert.equal(db.rowsOf("cbt_attempt_starts").length, 1, "(user, paper) 한 건만 유지");
  assert.equal(db.rowsOf("cbt_attempt_starts")[0].started_at, later.toISOString());
});

test("시작 행이 없으면 채점하지 않는다", async () => {
  const db = makeDb({ startedAt: null });
  const r = await submitCbtAttempt(asClient(db), USER, PAPER, [1, 2, 3], {
    now: afterSeconds(STARTED, 600),
    ...quiet,
  });
  assert.ok(isCbtRuleError(r));
  assert.equal(r.error, "새로고침 후 다시 시작해주세요.");
  assert.equal(r.status, 400);
  assert.equal(db.rowsOf("cbt_attempts").length, 0);
});

test("정답이 없는 문제지는 시작 행을 건드리지 않고 거절한다", async () => {
  const db = makeDb();
  db.tables.paper_answers = [];
  const r = await submitCbtAttempt(asClient(db), USER, PAPER, [1], {
    now: afterSeconds(STARTED, 600),
    ...quiet,
  });
  assert.ok(isCbtRuleError(r));
  assert.equal(r.error, "이 문제지는 CBT를 지원하지 않아요.");
  assert.equal(db.rowsOf("cbt_attempt_starts").length, 1, "정답 조회는 읽기만이라 회수 전이다");
});

test("최소 응시시간 미만이면 거절하고 시작 행을 같은 시각으로 되돌린다", async () => {
  const db = makeDb();
  const now = afterSeconds(STARTED, MIN_ATTEMPT_SECONDS - 10);
  const r = await submitCbtAttempt(asClient(db), USER, PAPER, [1, 2, 3], { now, ...quiet });
  assert.ok(isCbtRuleError(r));
  assert.equal(
    r.error,
    "최소 1분 30초은 풀어야 채점할 수 있어요. 10초 후에 다시 시도해주세요.",
  );
  assert.equal(r.status, 400);
  assert.equal(db.rowsOf("cbt_attempts").length, 0);

  const starts = db.rowsOf("cbt_attempt_starts");
  assert.equal(starts.length, 1, "재시도할 수 있게 시작 행이 남아 있어야 한다");
  assert.equal(starts[0].started_at, STARTED.toISOString(), "원래 시각 그대로(대기 시간이 늘지 않는다)");

  // 10초 뒤 재시도는 통과한다.
  const ok = await submitCbtAttempt(asClient(db), USER, PAPER, [1, 2, 3], {
    now: afterSeconds(STARTED, MIN_ATTEMPT_SECONDS),
    ...quiet,
  });
  assert.ok(!isCbtRuleError(ok));
  assert.equal(ok.durationSeconds, MIN_ATTEMPT_SECONDS);
});

test("채점 전에 시작 행을 회수하므로 같은 시작으로 두 번 제출하면 두 번째는 거절된다", async () => {
  const db = makeDb();
  const now = afterSeconds(STARTED, 600);
  const first = await submitCbtAttempt(asClient(db), USER, PAPER, [1, 2, 3], { now, ...quiet });
  assert.ok(!isCbtRuleError(first));
  assert.equal(db.rowsOf("cbt_attempt_starts").length, 0);

  // 회수(delete)가 응시 insert 보다 먼저다 — 순서가 뒤집히면 동시 제출이 둘 다 통과한다.
  const ops = db.writes.map((w) => `${w.table}:${w.op}`);
  assert.ok(
    ops.indexOf("cbt_attempt_starts:delete") < ops.indexOf("cbt_attempts:insert"),
    `회수가 채점보다 먼저여야 한다: ${ops.join(" → ")}`,
  );

  const second = await submitCbtAttempt(asClient(db), USER, PAPER, [1, 2, 3], { now, ...quiet });
  assert.ok(isCbtRuleError(second));
  assert.equal(second.error, "새로고침 후 다시 시작해주세요.");
  assert.equal(db.rowsOf("cbt_attempts").length, 1, "응시는 한 번만 기록된다");
  assert.equal(
    db.rowsOf("user_question_status").find((r) => r.question_number === 1)!.wrong_count,
    0,
  );
  assert.equal(
    db.rowsOf("user_question_status").find((r) => r.question_number === 4)!.wrong_count,
    1,
    "안 푼 문항은 오답으로 한 번만 센다",
  );
});

test("채점: voided 문항은 무조건 정답, 답안 정제, 결과 모양", async () => {
  const db = makeDb({ answers: [1, 2, 3, 4], voided: [3] });
  const now = afterSeconds(STARTED, 600);
  // 3번은 틀린 답을 골랐지만 voided 라 정답. 4번은 소수(정제 → 안 푼 문제).
  const r = await submitCbtAttempt(asClient(db), USER, PAPER, [1, 5, 1, 4.5], { now, ...quiet });
  assert.ok(!isCbtRuleError(r));
  assert.equal(r.score, 2);
  assert.equal(r.totalQuestions, 4);
  assert.equal(r.durationSeconds, 600);
  assert.deepEqual(r.voidedQuestions, [3]);
  assert.deepEqual(r.questionResults, [
    { question_number: 1, selected_choice: 1, is_correct: true },
    { question_number: 2, selected_choice: 5, is_correct: false },
    { question_number: 3, selected_choice: 1, is_correct: true },
    { question_number: 4, selected_choice: null, is_correct: false },
  ]);
  assert.ok(typeof r.attemptId === "string" && r.attemptId.length > 0);
  assert.deepEqual(r.diagnosisProgress, { attemptCount: 1, wrongCount: 2 });

  const answers = db.rowsOf("cbt_attempt_answers");
  assert.equal(answers.length, 4);
  assert.ok(answers.every((a) => a.attempt_id === r.attemptId));
  const attempt = db.rowsOf("cbt_attempts")[0];
  assert.equal(attempt.score, 2);
  assert.equal(attempt.total_questions, 4);
  assert.equal(attempt.duration_seconds, 600);
});

test("출석 문항 수는 답을 고른 문항만 센다(빈 답안은 도장이 안 찍힌다)", async () => {
  // 12문항 중 10개만 답을 골랐고, 2개는 안 풀었다.
  const db = makeDb({ startedAt: OPEN_START });
  const now = afterSeconds(OPEN_START, 600);
  const r = await submitCbtAttempt(
    asClient(db),
    USER,
    PAPER,
    [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, null, null],
    { now, ...quiet },
  );
  assert.ok(!isCbtRuleError(r));
  const calls = db.rowsOf("attendance_calls");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].p_questions, 10, "채점된 12문항이 아니라 답을 고른 10문항");
  assert.equal(calls[0].p_min_questions, ATTENDANCE_MIN_QUESTIONS);
  assert.equal(calls[0].p_user_id, USER);

  // 전부 빈 답안이면 출석 RPC 자체를 부르지 않는다.
  const db2 = makeDb({ startedAt: OPEN_START });
  const r2 = await submitCbtAttempt(asClient(db2), USER, PAPER, [], { now, ...quiet });
  assert.ok(!isCbtRuleError(r2));
  assert.equal(r2.score, 0);
  assert.equal(db2.rowsOf("attendance_calls").length, 0);
});

test("응시 기록에 실패하면 500 이고 시작 행을 되돌린다", async () => {
  const db = makeDb();
  db.failNext.set("cbt_attempts", "boom");
  const r = await submitCbtAttempt(asClient(db), USER, PAPER, [1], {
    now: afterSeconds(STARTED, 600),
    ...quiet,
  });
  assert.ok(isCbtRuleError(r));
  assert.equal(r.error, "채점에 실패했어요.");
  assert.equal(r.status, 500);
  assert.equal(db.rowsOf("cbt_attempt_starts").length, 1, "재시도할 수 있게 시작 행을 되돌린다");
  assert.equal(db.rowsOf("cbt_attempt_starts")[0].started_at, STARTED.toISOString());
});
