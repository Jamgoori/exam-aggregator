import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWrongNoteGroups,
  type WrongAnswerRow,
  type WrongNoteAttemptRow,
} from "./wrong-notes";
import type { Subject } from "./types";

// 웹 오답노트와 앱 오답노트가 같은 숫자를 내는 근거가 이 함수 하나다. 여기가 틀리면
// "남은 오답 N" 이 양쪽에서 동시에 어긋난다.

const KOREAN: Subject = { id: "s1", slug: "korean", name: "국어", display_order: 1 };
const HISTORY: Subject = { id: "s2", slug: "history", name: "한국사", display_order: 2 };

function attempt(
  id: string,
  createdAt: string,
  paperId: string,
  subject: Subject = KOREAN,
  extra: Partial<WrongNoteAttemptRow> = {},
): WrongNoteAttemptRow {
  return {
    id,
    created_at: createdAt,
    exam_papers: {
      id: paperId,
      title: `${paperId} 문제지`,
      level: "9급",
      // 오답노트 카드의 링크 주소를 제목에서 계산하느라 함께 실어 보내는 값
      // (paper-slug.ts). 화면에는 쓰지 않지만 타입상 빠질 수 없다.
      round: 1,
      track: null,
      choice_count: 4,
      subjects: subject,
      exam_types: null,
    },
    ...extra,
  };
}

const wrong = (attemptId: string, q: number, choice: number | null = 1): WrongAnswerRow => ({
  attempt_id: attemptId,
  question_number: q,
  selected_choice: choice,
});

test("최신 응시에서 맞힌 문항은 극복으로 본다", () => {
  const attempts = [
    attempt("a2", "2026-07-02T00:00:00Z", "p1"),
    attempt("a1", "2026-07-01T00:00:00Z", "p1"),
  ];
  // 1번은 두 번 다 틀림, 2번은 첫 응시에만 틀림 → 2번은 극복.
  const rows = [wrong("a1", 1), wrong("a1", 2), wrong("a2", 1)];

  const [group] = buildWrongNoteGroups(attempts, rows);
  const byNum = new Map(group.papers[0].questions.map((q) => [q.questionNumber, q]));

  assert.equal(byNum.get(1)!.resolved, false);
  assert.equal(byNum.get(1)!.wrongCount, 2);
  assert.equal(byNum.get(2)!.resolved, true);
  assert.equal(group.unresolvedCount, 1);
  assert.equal(group.resolvedCount, 1);
});

test("statusOverrides 가 최신 응시 판정보다 우선한다 (섞어풀기로 극복한 경우)", () => {
  const attempts = [attempt("a1", "2026-07-01T00:00:00Z", "p1")];
  const rows = [wrong("a1", 1)];
  const overrides = new Map([["p1#1", true]]);

  const [group] = buildWrongNoteGroups(attempts, rows, undefined, overrides);
  assert.equal(group.papers[0].questions[0].resolved, true);
  assert.equal(group.unresolvedCount, 0);
});

test("deletedKeys 에 있는 문항은 집계에서 빠진다", () => {
  const attempts = [attempt("a1", "2026-07-01T00:00:00Z", "p1")];
  const rows = [wrong("a1", 1), wrong("a1", 2)];

  const [group] = buildWrongNoteGroups(attempts, rows, new Set(["p1#1"]));
  assert.deepEqual(
    group.papers[0].questions.map((q) => q.questionNumber),
    [2],
  );
});

test("남은 오답이 하나도 없으면 그 문제지는 아예 안 나온다", () => {
  const attempts = [attempt("a1", "2026-07-01T00:00:00Z", "p1")];
  const rows = [wrong("a1", 1)];
  assert.deepEqual(buildWrongNoteGroups(attempts, rows, new Set(["p1#1"])), []);
});

test("가장 최근에 고른 답을 남긴다", () => {
  const attempts = [
    attempt("a2", "2026-07-02T00:00:00Z", "p1"),
    attempt("a1", "2026-07-01T00:00:00Z", "p1"),
  ];
  const rows = [wrong("a1", 1, 2), wrong("a2", 1, 4)];
  const [group] = buildWrongNoteGroups(attempts, rows);
  assert.equal(group.papers[0].questions[0].lastSelectedChoice, 4);
});

test("문제지가 지워진 응시는 건너뛴다", () => {
  const attempts: WrongNoteAttemptRow[] = [
    { id: "a1", created_at: "2026-07-01T00:00:00Z", exam_papers: null },
  ];
  assert.deepEqual(buildWrongNoteGroups(attempts, [wrong("a1", 1)]), []);
});

test("문제지 카드에 응시 횟수와 최근 점수가 담긴다", () => {
  const attempts = [
    attempt("a2", "2026-07-02T00:00:00Z", "p1", KOREAN, { score: 17, total_questions: 20 }),
    attempt("a1", "2026-07-01T00:00:00Z", "p1", KOREAN, { score: 12, total_questions: 20 }),
  ];
  const [group] = buildWrongNoteGroups(attempts, [wrong("a1", 1), wrong("a2", 1)]);
  const paper = group.papers[0];
  assert.equal(paper.attemptCount, 2);
  assert.equal(paper.latestScore, 17);
  assert.equal(paper.lastAttemptAt, "2026-07-02T00:00:00Z");
});

test("점수가 없는 응시 목록이면 null 로 둔다", () => {
  const attempts = [attempt("a1", "2026-07-01T00:00:00Z", "p1")];
  const [group] = buildWrongNoteGroups(attempts, [wrong("a1", 1)]);
  assert.equal(group.papers[0].latestScore, null);
  assert.equal(group.papers[0].latestTotal, null);
});

test("과목은 display_order 순으로, 문제지는 최근 응시 순으로 정렬한다", () => {
  const attempts = [
    attempt("a1", "2026-07-01T00:00:00Z", "p-old", HISTORY),
    attempt("a2", "2026-07-05T00:00:00Z", "p-new", HISTORY),
    attempt("a3", "2026-07-03T00:00:00Z", "p-kor", KOREAN),
  ];
  const rows = [wrong("a1", 1), wrong("a2", 1), wrong("a3", 1)];

  const groups = buildWrongNoteGroups(attempts, rows);
  assert.deepEqual(
    groups.map((g) => g.subject.name),
    ["국어", "한국사"],
  );
  assert.deepEqual(
    groups[1].papers.map((p) => p.paper.id),
    ["p-new", "p-old"],
  );
});

test("문항은 번호 오름차순", () => {
  const attempts = [attempt("a1", "2026-07-01T00:00:00Z", "p1")];
  const rows = [wrong("a1", 9), wrong("a1", 2), wrong("a1", 5)];
  const [group] = buildWrongNoteGroups(attempts, rows);
  assert.deepEqual(
    group.papers[0].questions.map((q) => q.questionNumber),
    [2, 5, 9],
  );
});

test("빈 입력에도 안전하다", () => {
  assert.deepEqual(buildWrongNoteGroups([], []), []);
});
