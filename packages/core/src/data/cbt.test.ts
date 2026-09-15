import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asClient, FakeSupabase } from "../test-support/fake-supabase";
import { recoverAttempt, RECOVER_ATTEMPT_WINDOW_MS } from "./cbt";

const USER = "user-1";
const PAPER = "paper-1";
const STARTED_AT = "2026-09-15T10:00:00.000Z";

function db(rows: { attempts?: Record<string, unknown>[]; answers?: Record<string, unknown>[] } = {}) {
  return new FakeSupabase({
    cbt_attempts: rows.attempts ?? [],
    cbt_attempt_answers: rows.answers ?? [],
  });
}

describe("recoverAttempt", () => {
  it("시작 시각 이후(−5분 창 포함) 본인·같은 문제지의 최신 응시와 문항 정오를 돌려준다", async () => {
    const fake = db({
      attempts: [
        {
          id: "old",
          user_id: USER,
          paper_id: PAPER,
          score: 1,
          total_questions: 2,
          duration_seconds: 100,
          // 창 밖(6분 전) — 지난주 응시 같은 것.
          created_at: new Date(new Date(STARTED_AT).getTime() - 6 * 60_000).toISOString(),
        },
        {
          id: "recent",
          user_id: USER,
          paper_id: PAPER,
          score: 2,
          total_questions: 2,
          duration_seconds: 120,
          created_at: "2026-09-15T10:02:00.000Z",
        },
        {
          id: "other-paper",
          user_id: USER,
          paper_id: "paper-2",
          score: 0,
          total_questions: 2,
          duration_seconds: 95,
          created_at: "2026-09-15T10:03:00.000Z",
        },
      ],
      answers: [
        { attempt_id: "recent", question_number: 2, selected_choice: 3, is_correct: true },
        { attempt_id: "recent", question_number: 1, selected_choice: null, is_correct: true },
        { attempt_id: "old", question_number: 1, selected_choice: 1, is_correct: false },
      ],
    });
    const r = await recoverAttempt(asClient(fake), USER, PAPER, STARTED_AT);
    assert.ok(r);
    assert.equal(r.attemptId, "recent");
    assert.equal(r.score, 2);
    assert.equal(r.totalQuestions, 2);
    assert.equal(r.durationSeconds, 120);
    assert.deepEqual(
      r.questionResults.map((q) => q.question_number),
      [1, 2],
    );
    assert.deepEqual(r.questionResults[0], { question_number: 1, selected_choice: null, is_correct: true });
  });

  it("다른 기기가 먼저 만든 응시(created_at 이 startedAt 보다 이름)도 5분 창 안이면 찾는다", async () => {
    const fake = db({
      attempts: [
        {
          id: "earlier",
          user_id: USER,
          paper_id: PAPER,
          score: 3,
          total_questions: 5,
          duration_seconds: null,
          created_at: new Date(new Date(STARTED_AT).getTime() - RECOVER_ATTEMPT_WINDOW_MS + 1000).toISOString(),
        },
      ],
    });
    const r = await recoverAttempt(asClient(fake), USER, PAPER, new Date(STARTED_AT));
    assert.ok(r);
    assert.equal(r.attemptId, "earlier");
    // duration_seconds null 은 0 으로.
    assert.equal(r.durationSeconds, 0);
    assert.deepEqual(r.questionResults, []);
  });

  it("창 안에 응시가 없으면 null", async () => {
    const fake = db({
      attempts: [
        {
          id: "old",
          user_id: USER,
          paper_id: PAPER,
          score: 1,
          total_questions: 2,
          duration_seconds: 100,
          created_at: "2026-09-14T10:00:00.000Z",
        },
      ],
    });
    assert.equal(await recoverAttempt(asClient(fake), USER, PAPER, STARTED_AT), null);
  });

  it("startedAt 이 유효한 시각이 아니면 조회 없이 null", async () => {
    const fake = db();
    assert.equal(await recoverAttempt(asClient(fake), USER, PAPER, "not-a-date"), null);
    assert.deepEqual(fake.reads, []);
  });

  it("조회 실패는 삼키지 않고 던진다", async () => {
    const fake = db();
    fake.failNext.set("cbt_attempts", "boom");
    await assert.rejects(() => recoverAttempt(asClient(fake), USER, PAPER, STARTED_AT), /응시 복원 실패/);
  });
});
