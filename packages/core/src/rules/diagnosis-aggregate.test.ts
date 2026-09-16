import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient as asSupabase, type Row } from "../test-support/fake-supabase";
import { getDiagnosisAggregate, toDiagnosisBoard } from "./diagnosis-aggregate";

// 진단 대시보드의 무AI 집계(웹 진단 페이지 + Edge `diagnosis-aggregate` 가 함께 부른다).
//
// 여기서 지키는 것:
//   1. "틀린 문항 수"는 **문항 단위**다(같은 문항을 두 번 틀려도 1) — 사람이 읽는 단위가
//      "이 개념 문제 N개를 틀렸다"여야 막대 길이가 뜻을 갖는다.
//   2. 정답률의 분모는 그 개념 문항을 **푼 것 전체**다(맞힌 문항 포함). 예전처럼 오답만
//      순회하면 한 번씩만 푼 사용자는 모든 개념이 0%가 된다.
//   3. 개념 축은 정본 concept_id 다(keyword_title 은 문항 1:1이라 막대가 전부 높이 1이 된다).
//   4. 앱용 투영(toDiagnosisBoard)은 화면이 그리는 값만 남긴다 — 계약에 안 그리는 값을
//      넣으면 "추가만" 원칙 때문에 영영 못 뺀다.

const USER = "user-1";
const NOW = new Date("2026-09-16T04:00:00Z");
const SUBJ = { name: "국어", slug: "korean" };

// 문제지 1장(3문항)을 한 번 응시해 1·2번을 틀린 계정. 세 문항 모두 같은 정본 개념이다.
function tables(overrides: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    cbt_attempts: [
      {
        id: "a1",
        user_id: USER,
        paper_id: "p1",
        score: 1,
        total_questions: 3,
        created_at: "2026-09-15T00:00:00Z",
        // 임베드는 미리 중첩해 둔다(가짜 클라이언트는 select 문자열을 해석하지 않는다).
        exam_papers: { subject_id: "s1", subjects: SUBJ },
      },
    ],
    cbt_attempt_answers: [
      { attempt_id: "a1", question_number: 1, selected_choice: 3, is_correct: false },
      { attempt_id: "a1", question_number: 2, selected_choice: 2, is_correct: false },
      { attempt_id: "a1", question_number: 3, selected_choice: 1, is_correct: true },
      // 건너뛴 문항은 "틀렸다"가 아니라 "안 풀었다" — 분모에도 안 들어간다.
      { attempt_id: "a1", question_number: 4, selected_choice: null, is_correct: null },
    ],
    review_sessions: [],
    review_session_items: [],
    exam_papers: [{ id: "p1", subject_id: "s1", subjects: SUBJ }],
    questions: [
      { id: "q1", paper_id: "p1", question_number: 1 },
      { id: "q2", paper_id: "p1", question_number: 2 },
      { id: "q3", paper_id: "p1", question_number: 3 },
    ],
    question_explanations: [
      { question_id: "q1", paper_id: "p1", keyword_title: "문장 성분 1", concept_id: "c1" },
      { question_id: "q2", paper_id: "p1", keyword_title: "문장 성분 2", concept_id: "c1" },
      { question_id: "q3", paper_id: "p1", keyword_title: "문장 성분 3", concept_id: "c1" },
    ],
    concepts: [{ id: "c1", name: "문장 성분", kind: "지식형" }],
    ...overrides,
  };
}

test("개념 하나에 오답 2·응시 3문항이면 wrongCount 2 · 정답률 33% · 예상 +66.7점", async () => {
  const fake = new FakeSupabase(tables());
  const agg = await getDiagnosisAggregate(asSupabase(fake), USER, {}, { now: NOW });

  assert.deepEqual(agg.window, { days: 7, widened: false });
  assert.equal(agg.concepts.length, 1);
  const c = agg.concepts[0];
  assert.equal(c.concept, "문장 성분"); // keyword_title 이 아니라 정본 개념 이름
  assert.equal(c.conceptId, "c1");
  assert.equal(c.conceptKind, "지식형");
  assert.equal(c.wrongCount, 2);
  // 분모는 푼 것 전체(3문항) — 맞힌 3번이 빠지면 0%가 된다.
  assert.equal(c.answeredCount, 3);
  assert.equal(c.accuracyPct, 33);
  // 이 개념을 다 맞히면 그 과목 회차 점수가 2/3 만큼 오른다.
  assert.equal(c.scoreGainPct, 66.7);
  // 같은 개념 기출 수(question_explanations 의 concept_id 코퍼스).
  assert.equal(c.corpusCount, 3);

  assert.deepEqual(agg.totals, { attempts: 1, wrongQuestions: 2, conceptsWithKeyword: 1 });
  assert.deepEqual(agg.subjects, [
    { id: "s1", name: "국어", slug: "korean", attempts: 1, avgScorePct: 33, recentScores: [33] },
  ]);
  assert.equal(agg.bySubject.length, 1);
  assert.equal(agg.bySubject[0].totalWrong, 2);
});

test("같은 문항을 두 번 틀려도 오답 수는 1(문항 단위)", async () => {
  const fake = new FakeSupabase(
    tables({
      review_sessions: [
        { id: "s1", user_id: USER, submitted_at: "2026-09-15T02:00:00Z", created_at: "2026-09-15T01:00:00Z" },
      ],
      // 이미 CBT 에서 틀린 1번 문항을 복습에서 또 틀렸다.
      review_session_items: [
        { session_id: "s1", paper_id: "p1", question_number: 1, selected_choice: 4, is_correct: false },
      ],
    }),
  );
  const agg = await getDiagnosisAggregate(asSupabase(fake), USER, {}, { now: NOW });
  const c = agg.concepts[0];
  assert.equal(c.wrongCount, 2); // 1번·2번 두 문항 — 1번을 두 번 틀렸다고 3이 되지 않는다
  assert.equal(c.answeredCount, 4); // 푼 횟수는 4번(CBT 3 + 복습 1)
  assert.equal(c.accuracyPct, 25);
});

test("기간 안에 푼 것이 없으면 사다리를 따라 창을 넓히고 그 사실을 밝힌다", async () => {
  const fake = new FakeSupabase(
    tables({
      cbt_attempts: [
        {
          id: "a1",
          user_id: USER,
          paper_id: "p1",
          score: 1,
          total_questions: 3,
          // 20일 전 — 기본 7일 창에는 안 들어오고 30일 칸에서 잡힌다.
          created_at: "2026-08-27T00:00:00Z",
          exam_papers: { subject_id: "s1", subjects: SUBJ },
        },
      ],
    }),
  );
  const agg = await getDiagnosisAggregate(asSupabase(fake), USER, {}, { now: NOW });
  assert.deepEqual(agg.window, { days: 30, widened: true });
  assert.equal(agg.concepts[0].wrongCount, 2);
});

test("widen:false 면 빈 창 그대로 둔다(분석 경로 — 창이 곧 요금이다)", async () => {
  const fake = new FakeSupabase(
    tables({
      cbt_attempts: [
        {
          id: "a1",
          user_id: USER,
          paper_id: "p1",
          score: 1,
          total_questions: 3,
          created_at: "2026-08-27T00:00:00Z",
          exam_papers: { subject_id: "s1", subjects: SUBJ },
        },
      ],
    }),
  );
  const agg = await getDiagnosisAggregate(asSupabase(fake), USER, { widen: false }, { now: NOW });
  assert.deepEqual(agg.window, { days: 7, widened: false });
  assert.equal(agg.concepts.length, 0);
});

test("앱용 투영은 화면이 그리는 값만 남긴다(프롬프트 입력·과목 통계는 뺀다)", async () => {
  const fake = new FakeSupabase(tables());
  const agg = await getDiagnosisAggregate(asSupabase(fake), USER, {}, { now: NOW });
  const board = toDiagnosisBoard(agg);

  assert.deepEqual(board.window, agg.window);
  assert.deepEqual(board.subjects, [{ name: "국어", slug: "korean" }]);
  assert.deepEqual(Object.keys(board.concepts[0]).sort(), [
    "accuracyPct",
    "concept",
    "conceptId",
    "corpusCount",
    "scoreGainPct",
    "subject",
    "subjectSlug",
    "wrongCount",
  ]);
  // totals 는 계약에 없다(웹 page.tsx 도 보드에 넘기지 않는다).
  assert.equal("totals" in board, false);
  assert.deepEqual(board.bySubject[0].concepts, board.concepts);
});
