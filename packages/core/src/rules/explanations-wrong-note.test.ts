import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient as asSupabase, type Row } from "../test-support/fake-supabase";
import { resolveWrongNoteExplanations } from "./explanations-wrong-note";

// 오답노트 안의 해설(explanations-get context:"wrong-note", 설계서 §6.7 #7).
//
// 여기서 지키는 것은 넷이다:
//   1. 프리미엄이 아니면 해설 **본문이 서버를 떠나지 않는다**(잠금 자리만).
//   2. 본인이 답하지 않은 문항은 프리미엄이어도 나가지 않는다 — 앱은 문항 번호를
//      클라이언트가 보내므로, 이게 없으면 해설 페이지의 한도를 우회하는 경로가 된다.
//   3. "답했다" 판정은 RPC own_wrong_answers 와 같다: 형제(dedup) 문제지의 행도 인정하고,
//      user_question_status 든 cbt_attempt_answers 든 행이 있으면 된다(건너뛴 문항 포함).
//   4. 쿼터·로그를 **쓰지 않는다**(explanation_access_log·explanation_daily_views 미기록).
//      웹 오답노트가 admin 조회라 한 줄도 남기지 않는 것과 같아야 한다.

const USER = "user-1";
const REP = "p-rep";
const SIBLING = "p-sibling";

function paper(id: string, track: string | null): Row {
  return {
    id,
    subject_id: "korean",
    exam_type_id: "gukga",
    year: 2026,
    round: 1,
    level: "9급",
    track,
    title: track ? `2026 국가직 9급 국어 (${track})` : "2026 국가직 9급 국어",
    created_at: "2026-01-01T00:00:00Z",
  };
}

// 문항 3개(1·2·3번)와 해설 3개를 가진 문제지 하나. 이미지는 1번에만 붙여 둔다.
function fixtures(overrides: Partial<Record<string, Row[]>> = {}) {
  return {
    exam_papers: [paper(REP, "일반행정"), paper(SIBLING, "세무")],
    paper_answers: [
      { paper_id: REP, answers: [1, 2, 3], voided_questions: [] },
      { paper_id: SIBLING, answers: [1, 2, 3], voided_questions: [] },
    ],
    questions: [
      {
        id: "q1",
        paper_id: REP,
        question_number: 1,
        choice_count: 5,
        question_images: [{ order_index: 0, image_path: "crop/1.webp" }],
      },
      { id: "q2", paper_id: REP, question_number: 2, choice_count: 4, question_images: [] },
      { id: "q3", paper_id: REP, question_number: 3, choice_count: 4, question_images: [] },
    ],
    question_explanations: [
      { question_id: "q1", keyword_title: "1번 개념", keyword_explanation: "본문 1" },
      { question_id: "q2", keyword_title: "2번 개념", keyword_explanation: "본문 2" },
      { question_id: "q3", keyword_title: "3번 개념", keyword_explanation: "본문 3" },
    ],
    user_question_status: [] as Row[],
    cbt_attempts: [] as Row[],
    cbt_attempt_answers: [] as Row[],
    explanation_access_log: [] as Row[],
    explanation_daily_views: [] as Row[],
    ...overrides,
  };
}

function statusRow(paperId: string, questionNumber: number): Row {
  return { user_id: USER, paper_id: paperId, question_number: questionNumber };
}

// 쿼터·로그 테이블에 쓰기가 한 번도 없었는지(이 모드의 핵심 단언).
function assertNoQuotaWrites(db: FakeSupabase) {
  const logged = db.writes.filter(
    (w) => w.table === "explanation_access_log" || w.table === "explanation_daily_views",
  );
  assert.deepEqual(logged, [], "wrong-note 모드는 열람 로그·일일 몫을 건드리지 않는다");
  assert.deepEqual(db.writes, [], "이 모드는 어떤 테이블에도 쓰지 않는다");
}

test("프리미엄 + 본인이 답한 문항이면 해설 본문을 내준다", async () => {
  const db = new FakeSupabase(
    fixtures({ user_question_status: [statusRow(REP, 1), statusRow(REP, 2)] }),
  );

  const out = await resolveWrongNoteExplanations(asSupabase(db), {
    userId: USER,
    paperId: REP,
    questionNumbers: [1, 2],
    premium: true,
  });

  assert.equal(out.locked, false);
  assert.deepEqual(out.lockedQuestionNumbers, []);
  assert.deepEqual(
    out.questions.map((q) => q.questionNumber),
    [1, 2],
  );
  assert.equal(out.questions[0].explanation.keywordTitle, "1번 개념");
  assert.equal(out.questions[0].correctChoice, 1, "정답은 요청 문제지의 paper_answers 에서");
  assert.equal(out.questions[0].choiceCount, 5);
  assert.deepEqual(out.questions[0].images, ["https://cdn.test/crop/1.webp"]);
  assert.equal(out.totalCount, 2);
  assertNoQuotaWrites(db);
});

test("프리미엄이 아니면 본문 없이 잠금 문항 번호만 — 해설 본문 조회 자체를 하지 않는다", async () => {
  const db = new FakeSupabase(
    fixtures({ user_question_status: [statusRow(REP, 1), statusRow(REP, 2)] }),
  );

  const out = await resolveWrongNoteExplanations(asSupabase(db), {
    userId: USER,
    paperId: REP,
    questionNumbers: [1, 2, 3],
    premium: false,
  });

  assert.equal(out.locked, true);
  assert.deepEqual(out.questions, [], "무료 회원에게는 본문이 서버를 떠나지 않는다");
  assert.deepEqual(out.lockedQuestionNumbers, [1, 2], "답하지 않은 3번은 잠금 자리도 없다");
  assert.equal(out.totalCount, 2);
  assertNoQuotaWrites(db);
});

test("본인이 답하지 않은 문항은 프리미엄이어도 빠진다", async () => {
  const db = new FakeSupabase(fixtures({ user_question_status: [statusRow(REP, 2)] }));

  const out = await resolveWrongNoteExplanations(asSupabase(db), {
    userId: USER,
    paperId: REP,
    questionNumbers: [1, 2, 3],
    premium: true,
  });

  assert.deepEqual(
    out.questions.map((q) => q.questionNumber),
    [2],
  );
  assertNoQuotaWrites(db);
});

test("행이 하나도 없으면 빈 결과(해설 조회까지 가지 않는다)", async () => {
  const db = new FakeSupabase(fixtures());

  const out = await resolveWrongNoteExplanations(asSupabase(db), {
    userId: USER,
    paperId: REP,
    questionNumbers: [1, 2, 3],
    premium: true,
  });

  assert.deepEqual(out.questions, []);
  assert.equal(out.totalCount, 0);
  assert.ok(
    !db.reads.includes("question_explanations"),
    "답한 문항이 없으면 해설 테이블을 읽지 않는다",
  );
  assertNoQuotaWrites(db);
});

test("형제 문제지(같은 메타·같은 정답)에만 행이 있어도 대표 id 요청에 답한다", async () => {
  // 웹 오답노트는 dedup 대표 id 로 해설을 조회하는데 사용자 상태 행은 실제(형제) id 에 있다 —
  // 요청 id 로만 검사하면 형제 문제지 응시자만 해설을 못 받는다(RPC own_wrong_answers 와 같은 이유).
  const db = new FakeSupabase(fixtures({ user_question_status: [statusRow(SIBLING, 3)] }));

  const out = await resolveWrongNoteExplanations(asSupabase(db), {
    userId: USER,
    paperId: REP,
    questionNumbers: [3],
    premium: true,
  });

  assert.deepEqual(
    out.questions.map((q) => q.questionNumber),
    [3],
  );
  assertNoQuotaWrites(db);
});

test("메타데이터만 같고 정답 지문이 다르면 형제가 아니다", async () => {
  const db = new FakeSupabase(
    fixtures({
      paper_answers: [
        { paper_id: REP, answers: [1, 2, 3], voided_questions: [] },
        // 같은 (과목·직렬·연도·회차·급수)지만 정답이 다르다 → 다른 시험지.
        { paper_id: SIBLING, answers: [4, 4, 4], voided_questions: [] },
      ],
      user_question_status: [statusRow(SIBLING, 3)],
    }),
  );

  const out = await resolveWrongNoteExplanations(asSupabase(db), {
    userId: USER,
    paperId: REP,
    questionNumbers: [3],
    premium: true,
  });

  assert.deepEqual(out.questions, [], "다른 시험지의 응시 기록으로 해설을 받을 수 없다");
  assertNoQuotaWrites(db);
});

test("CBT 응시 행만 있어도(건너뛴 문항 포함) 답한 것으로 본다", async () => {
  // 웹 응시 상세는 selected_choice 가 null 인 문항에도 정답·해설을 보여준다
  // (cbt_attempt_answers 에는 모든 문항에 행이 있다) — "답했다" = "행이 있다".
  const db = new FakeSupabase(
    fixtures({
      cbt_attempts: [{ id: "a1", user_id: USER, paper_id: SIBLING }],
      cbt_attempt_answers: [
        { attempt_id: "a1", question_number: 1, selected_choice: null },
        { attempt_id: "a1", question_number: 2, selected_choice: 3 },
      ],
    }),
  );

  const out = await resolveWrongNoteExplanations(asSupabase(db), {
    userId: USER,
    paperId: REP,
    questionNumbers: [1, 2, 3],
    premium: true,
  });

  assert.deepEqual(
    out.questions.map((q) => q.questionNumber),
    [1, 2],
  );
  assertNoQuotaWrites(db);
});

test("남의 응시·상태 행으로는 해설이 나가지 않는다", async () => {
  const db = new FakeSupabase(
    fixtures({
      user_question_status: [{ user_id: "other", paper_id: REP, question_number: 1 }],
      cbt_attempts: [{ id: "a9", user_id: "other", paper_id: REP }],
      cbt_attempt_answers: [{ attempt_id: "a9", question_number: 2, selected_choice: 1 }],
    }),
  );

  const out = await resolveWrongNoteExplanations(asSupabase(db), {
    userId: USER,
    paperId: REP,
    questionNumbers: [1, 2],
    premium: true,
  });

  assert.deepEqual(out.questions, []);
  assertNoQuotaWrites(db);
});
