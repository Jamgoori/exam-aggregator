import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient, type Row } from "../test-support/fake-supabase";
import { recordQuestionResults } from "./question-status";
import { srsDueAt, SRS_INITIAL } from "../srs";

// 문항 상태 갱신 규칙의 계약 테스트. 여기서 지키는 것:
//  · wrong_count 는 "틀린 채 제출된 횟수"라 증분이다(덮어쓰기가 아니다).
//  · 대기 풀(srs_due_at null) 오답은 스케줄을 심지 않는다 — 큐가 유입 속도대로 불어나면 안 된다.
//  · 스케줄이 있는 문항은 정답에 간격이 벌어진다.
//  · leech 로 접힌 문항은 맞혀도 자동으로 풀리지 않는다(되살리기는 수동).
//  · source 는 그대로 행에 남는다("mix" 포함) — 이력·집계가 이 값으로 갈린다.

const USER = "user-1";
const PAPER = "paper-1";
const NOW = new Date("2026-09-15T03:00:00Z"); // KST 12:00
const PK = { user_question_status: ["user_id", "paper_id", "question_number"] };

function status(questionNumber: number, overrides: Partial<Row> = {}): Row {
  return {
    user_id: USER,
    paper_id: PAPER,
    question_number: questionNumber,
    wrong_count: 0,
    last_is_correct: true,
    last_answered_at: null,
    srs_due_at: null,
    srs_interval_days: null,
    srs_ease: null,
    srs_reps: null,
    srs_lapses: null,
    srs_suspended_at: null,
    ...overrides,
  };
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

const noTrial = { now: NOW, fuzz: () => 0.5, startTrial: async () => null };

test("첫 오답은 wrong_count 1·대기 풀(srs_due_at null)로 남고, 재오답은 증분된다", async () => {
  const db = new FakeSupabase({ user_question_status: [] }, { primaryKeys: PK });

  await recordQuestionResults(asClient(db), USER, PAPER, [
    { question_number: 1, is_correct: false },
    { question_number: 2, is_correct: true },
  ], "cbt", noTrial);

  const rows = db.rowsOf("user_question_status");
  assert.equal(rows.length, 2);
  const q1 = rows.find((r) => r.question_number === 1)!;
  assert.equal(q1.wrong_count, 1);
  assert.equal(q1.last_is_correct, false);
  assert.equal(q1.srs_due_at, null, "대기 풀 오답에 스케줄을 심으면 안 된다");
  assert.equal(q1.srs_interval_days, SRS_INITIAL.intervalDays);
  assert.equal(q1.source, "cbt");
  assert.equal(q1.last_answered_at, NOW.toISOString());

  // 같은 문항을 또 틀리면 +1, 맞히면 그대로.
  await recordQuestionResults(asClient(db), USER, PAPER, [
    { question_number: 1, is_correct: false },
    { question_number: 2, is_correct: false },
  ], "cbt", noTrial);
  assert.equal(db.rowsOf("user_question_status").find((r) => r.question_number === 1)!.wrong_count, 2);
  assert.equal(db.rowsOf("user_question_status").find((r) => r.question_number === 2)!.wrong_count, 1);

  await recordQuestionResults(asClient(db), USER, PAPER, [
    { question_number: 1, is_correct: true },
  ], "cbt", noTrial);
  const after = db.rowsOf("user_question_status").find((r) => r.question_number === 1)!;
  assert.equal(after.wrong_count, 2, "정답은 wrong_count 를 깎지 않는다");
  assert.equal(after.last_is_correct, true);
  assert.equal(after.srs_due_at, null, "대기 풀 문항은 맞혀도 스케줄에 올라가지 않는다");
  // 스케줄 없는 채점은 srs_reviews 이력에 남지 않는다.
  assert.equal(db.rowsOf("srs_reviews").length, 0);
});

test("스케줄이 있는 문항은 정답에 간격이 벌어지고 이력이 남는다", async () => {
  const db = new FakeSupabase(
    {
      user_question_status: [
        status(5, {
          wrong_count: 1,
          srs_due_at: daysAgo(0.5),
          srs_interval_days: 3,
          srs_ease: 2.5,
          srs_reps: 2,
          srs_lapses: 0,
          last_answered_at: daysAgo(3),
        }),
      ],
    },
    { primaryKeys: PK },
  );

  await recordQuestionResults(asClient(db), USER, PAPER, [
    { question_number: 5, is_correct: true },
  ], "review", noTrial);

  const row = db.rowsOf("user_question_status")[0];
  assert.equal(row.srs_reps, 3);
  // 3일 × ease 2.5 = 7.5 → 8일. fuzz 0.5 는 delta 0 이라 그대로.
  assert.equal(row.srs_interval_days, 8);
  assert.equal(row.srs_due_at, srsDueAt(NOW, 8).toISOString());
  assert.ok(new Date(row.srs_due_at as string).getTime() > NOW.getTime());
  assert.equal(row.wrong_count, 1);
  assert.equal(row.source, "review");

  const log = db.rowsOf("srs_reviews");
  assert.equal(log.length, 1);
  assert.equal(log[0].prev_interval_days, 3);
  assert.equal(log[0].next_interval_days, 8);
  assert.equal(log[0].elapsed_days, 3);
  assert.equal(log[0].source, "review");
});

test("leech 판정에 걸리면 접히고(srs_suspended_at), 접힌 문항은 맞혀도 그대로다", async () => {
  const db = new FakeSupabase(
    {
      user_question_status: [
        // lapses 7 에서 예정일 지나 또 틀리면 8 = SRS_LEECH_THRESHOLD.
        status(1, {
          wrong_count: 7,
          srs_due_at: daysAgo(2),
          srs_interval_days: 1,
          srs_ease: 1.3,
          srs_reps: 0,
          srs_lapses: 7,
          last_answered_at: daysAgo(3),
        }),
        // 이미 접힌 문항.
        status(2, {
          wrong_count: 8,
          srs_due_at: daysAgo(1),
          srs_interval_days: 1,
          srs_ease: 1.3,
          srs_reps: 0,
          srs_lapses: 8,
          last_answered_at: daysAgo(3),
          srs_suspended_at: "2026-09-01T00:00:00.000Z",
        }),
      ],
    },
    { primaryKeys: PK },
  );

  await recordQuestionResults(asClient(db), USER, PAPER, [
    { question_number: 1, is_correct: false },
    { question_number: 2, is_correct: true },
  ], "mix", noTrial);

  const rows = db.rowsOf("user_question_status");
  const q1 = rows.find((r) => r.question_number === 1)!;
  assert.equal(q1.srs_lapses, 8);
  assert.equal(q1.srs_suspended_at, NOW.toISOString(), "leech 순간에 접혀야 한다");
  assert.ok(q1.srs_due_at != null, "접혀도 스케줄은 지우지 않는다(되살릴 때 진도 유지)");

  const q2 = rows.find((r) => r.question_number === 2)!;
  assert.equal(q2.srs_suspended_at, "2026-09-01T00:00:00.000Z", "맞혔다고 자동으로 풀리면 안 된다");
  assert.equal(q2.srs_reps, 1);
  assert.equal(q2.source, "mix");
});

test("source 'mix' 는 행과 이력에 그대로 남고 무료 기간 확인은 CBT 채점에서만 돈다", async () => {
  let trialCalls = 0;
  const opts = { now: NOW, fuzz: () => 0.5, startTrial: async () => { trialCalls++; return null; } };
  const db = new FakeSupabase(
    {
      user_question_status: [
        status(3, {
          srs_due_at: daysAgo(1),
          srs_interval_days: 1,
          srs_ease: 2.5,
          srs_reps: 1,
          srs_lapses: 0,
          last_answered_at: daysAgo(2),
        }),
      ],
    },
    { primaryKeys: PK },
  );

  await recordQuestionResults(asClient(db), USER, PAPER, [
    { question_number: 3, is_correct: true },
    { question_number: 4, is_correct: false },
  ], "mix", opts);

  const rows = db.rowsOf("user_question_status");
  assert.deepEqual(rows.map((r) => r.source), ["mix", "mix"]);
  assert.equal(db.rowsOf("srs_reviews")[0].source, "mix");
  assert.equal(trialCalls, 0, "mix 채점은 무료 기간을 켜지 않는다");

  await recordQuestionResults(asClient(db), USER, PAPER, [
    { question_number: 4, is_correct: true },
  ], "cbt", opts);
  assert.equal(trialCalls, 1, "cbt 채점은 무료 기간을 한 번 확인한다");
});

test("결과가 비어 있으면 아무것도 읽거나 쓰지 않는다", async () => {
  const db = new FakeSupabase({ user_question_status: [] }, { primaryKeys: PK });
  await recordQuestionResults(asClient(db), USER, PAPER, [], "cbt", noTrial);
  assert.equal(db.reads.length, 0);
  assert.equal(db.writes.length, 0);
});
