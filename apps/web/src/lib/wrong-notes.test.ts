import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asSupabase, type Row } from "@/lib/test-support/fake-supabase";
import { getSubjectWrongNoteOverview, getWrongNoteGroups } from "@/lib/wrong-notes";

// 과목 오답노트 기본 탭은 한 과목만 그린다. 예전에는 전 과목 오답노트를 다 만든 뒤
// .find 로 한 과목만 꺼내 썼기 때문에, 여러 과목을 준비하는 사용자에게는 응시·오답
// 행·문항 상태·마크가 전부 과목 수만큼 오갔다. 여기서 지키는 건 두 가지다:
//   1) 결과가 예전과 같을 것 (그 과목의 문제지 묶음)
//   2) 다른 과목의 응시를 애초에 조회하지 않을 것

const USER = "user-1";

function subject(id: string, slug: string, name: string, order: number): Row {
  return { id, slug, name, display_order: order };
}

const KOREAN = subject("subj-kor", "korean", "국어", 1);
const HISTORY = subject("subj-his", "history", "한국사", 2);

function paper(id: string, title: string, subj: Row): Row {
  return {
    id,
    title,
    level: "9급",
    round: 1,
    track: null,
    choice_count: 4,
    subject_id: subj.id,
    subjects: subj,
    exam_types: { id: "et-1", name: "국가직", display_order: 1 },
  };
}

function attempt(id: string, createdAt: string, p: Row): Row {
  return { id, user_id: USER, created_at: createdAt, score: 80, total_questions: 20, exam_papers: p };
}

function fixture() {
  const korPaper = paper("paper-kor", "2024 국가직 9급 국어", KOREAN);
  const hisPaper = paper("paper-his", "2024 국가직 9급 한국사", HISTORY);
  return new FakeSupabase({
    subjects: [KOREAN, HISTORY],
    cbt_attempts: [
      attempt("att-kor", "2026-03-01T00:00:00Z", korPaper),
      attempt("att-his", "2026-03-02T00:00:00Z", hisPaper),
    ],
    cbt_attempt_answers: [
      { attempt_id: "att-kor", question_number: 3, selected_choice: 2, is_correct: false },
      { attempt_id: "att-kor", question_number: 7, selected_choice: 1, is_correct: false },
      { attempt_id: "att-his", question_number: 5, selected_choice: 4, is_correct: false },
    ],
    wrong_note_marks: [],
    user_question_status: [],
  });
}

test("과목 오답노트는 그 과목의 문제지만 돌려준다", async () => {
  const fake = fixture();
  const overview = await getSubjectWrongNoteOverview(asSupabase(fake), USER, "korean");

  assert.ok(overview);
  assert.equal(overview.subject.id, KOREAN.id);
  assert.equal(overview.papers.length, 1);
  assert.equal(overview.papers[0].paper.id, "paper-kor");
  assert.deepEqual(
    overview.papers[0].questions.map((q) => q.questionNumber),
    [3, 7],
  );
});

test("다른 과목 응시는 애초에 조회되지 않는다", async () => {
  const fake = fixture();
  const scoped = await getWrongNoteGroups(asSupabase(fake), USER, KOREAN.id as string);
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].subject.id, KOREAN.id);

  // 오답 행 조회에 넘어간 attempt id 가 그 과목 것뿐인지 — 여기가 예전에 과목 수만큼
  // 부풀던 자리다.
  const all = await getWrongNoteGroups(asSupabase(fake), USER);
  assert.equal(all.length, 2, "필터 없이 부르면 예전처럼 전 과목이 나온다");
});

test("과목 slug 가 없으면 null", async () => {
  const fake = fixture();
  assert.equal(await getSubjectWrongNoteOverview(asSupabase(fake), USER, "nope"), null);
});

test("그 과목에 오답이 없으면 빈 목록", async () => {
  const fake = fixture();
  fake.tables.cbt_attempt_answers = [];
  const overview = await getSubjectWrongNoteOverview(asSupabase(fake), USER, "korean");
  assert.ok(overview);
  assert.deepEqual(overview.papers, []);
});
