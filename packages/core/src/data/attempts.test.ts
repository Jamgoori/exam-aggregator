import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asClient, FakeSupabase } from "../test-support/fake-supabase";
import { computeAttemptRounds, fetchAttemptDetail } from "./attempts";

describe("computeAttemptRounds", () => {
  it("문제지별로 오래된 순에 1부터 회독 번호를 매기고, 문제지가 없는 응시는 건너뛴다", () => {
    const attempts = [
      { id: "a3", created_at: "2026-09-03T00:00:00Z", exam_papers: { id: "p1" } },
      { id: "b1", created_at: "2026-09-02T00:00:00Z", exam_papers: { id: "p2" } },
      { id: "a1", created_at: "2026-09-01T00:00:00Z", exam_papers: { id: "p1" } },
      { id: "gone", created_at: "2026-09-04T00:00:00Z", exam_papers: null },
      { id: "a2", created_at: "2026-09-02T12:00:00Z", exam_papers: { id: "p1" } },
    ];
    const { attemptsByPaper, roundNumberByAttemptId } = computeAttemptRounds(attempts);
    assert.equal(attemptsByPaper.get("p1")?.length, 3);
    assert.equal(attemptsByPaper.get("p2")?.length, 1);
    assert.equal(roundNumberByAttemptId.get("a1"), 1);
    assert.equal(roundNumberByAttemptId.get("a2"), 2);
    assert.equal(roundNumberByAttemptId.get("a3"), 3);
    assert.equal(roundNumberByAttemptId.get("b1"), 1);
    assert.equal(roundNumberByAttemptId.has("gone"), false);
  });
});

describe("fetchAttemptDetail", () => {
  const USER = "user-1";
  const PAPER = "11111111-1111-4111-8111-111111111111";

  it("본인 응시가 아니면 null, 본인이면 회독 번호·문항 정오(맞힌 문항 포함)를 돌려준다", async () => {
    const paper = { id: PAPER, title: "t", level: null, round: 1, track: null, choice_count: 4, subjects: null, exam_types: null };
    const fake = new FakeSupabase({
      cbt_attempts: [
        { id: "att-1", user_id: USER, paper_id: PAPER, score: 1, total_questions: 2, duration_seconds: 100, created_at: "2026-09-01T00:00:00Z", exam_papers: paper },
        { id: "att-2", user_id: USER, paper_id: PAPER, score: 2, total_questions: 2, duration_seconds: 90, created_at: "2026-09-02T00:00:00Z", exam_papers: paper },
        { id: "other", user_id: "someone-else", paper_id: PAPER, score: 0, total_questions: 2, duration_seconds: 10, created_at: "2026-09-03T00:00:00Z", exam_papers: paper },
      ],
      cbt_attempt_answers: [
        { attempt_id: "att-2", question_number: 2, selected_choice: 3, is_correct: false },
        { attempt_id: "att-2", question_number: 1, selected_choice: 1, is_correct: true },
      ],
      questions: [
        { id: "q1", paper_id: PAPER, question_number: 1, choice_count: 5, question_images: [{ order_index: 0, image_path: "a.webp" }] },
      ],
    });
    const client = asClient(fake);

    assert.equal(await fetchAttemptDetail(client, USER, "other"), null);

    const detail = await fetchAttemptDetail(client, USER, "att-2");
    assert.ok(detail);
    assert.equal(detail.attempt.round, 2);
    assert.equal(detail.attempt.score, 2);
    assert.deepEqual(
      detail.questions.map((q) => [q.questionNumber, q.isCorrect, q.choiceCount, q.images.length]),
      [
        [1, true, 5, 1],
        [2, false, 4, 0],
      ],
    );
    // 정답은 이 조회에 절대 실리지 않는다(RPC own_wrong_answers 가 따로 준다).
    assert.equal("correctChoice" in detail.questions[0], false);
  });
});
