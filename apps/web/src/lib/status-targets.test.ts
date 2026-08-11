import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asSupabase, type Row } from "@/lib/test-support/fake-supabase";
import { resolveStatusTargets } from "@/lib/status-targets";

// 대표(rep) 문제지 id → 실제 상태 행이 있는 문제지로 되짚기.
//
// 여기서 지키는 건 하나다: 복습·섞어풀기 채점이 "사용자가 실제로 응시한 행"에
// 기록되는가. 이게 깨지면 오답노트가 계속 미극복으로 보이고, 원본 행의 srs_due_at 이
// 안 밀려 같은 문항이 매일 복습 큐에 다시 나온다.
//
// 대표 선정 규칙과 정답 대조 안전장치 자체는 packages/core 의 dedup-papers.test.ts 가
// 고정한다(이 테스트는 service_role 이 없어 정답 지문을 못 읽는 환경이라, 문서에 적힌
// "정답 대조를 건너뛰고 메타데이터만으로 합친다" 경로를 탄다).

const USER = "user-1";

// 같은 시험지를 직류만 다르게 두 번 올린 모양. track 만 다르고 나머지는 같다.
function paper(id: string, track: string | null, overrides: Partial<Row> = {}): Row {
  return {
    id,
    subject_id: "korean",
    exam_type_id: "beopwon",
    year: 2026,
    round: 1,
    level: "9",
    track,
    title: track ? `2026 법원직 9급 국어 (${track})` : "2026 법원직 9급 국어",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function status(paperId: string, questionNumber: number): Row {
  return { user_id: USER, paper_id: paperId, question_number: questionNumber };
}

test("중복 시험지가 없으면 되짚지 않는다 (상태 조회도 하지 않는다)", async () => {
  const db = new FakeSupabase({
    exam_papers: [paper("p-solo", null)],
    user_question_status: [status("p-solo", 7)],
    questions: [],
  });

  const out = await resolveStatusTargets(asSupabase(db), USER, [
    { paperId: "p-solo", questionNumber: 7 },
  ]);

  assert.equal(out.size, 0);
  assert.ok(
    !db.reads.includes("user_question_status"),
    "겹치는 문제지가 없으면 상태 조회까지 가지 않아야 한다",
  );
});

test("대표로 넘어온 문항을 사용자가 응시한 원본 문제지로 되짚는다", async () => {
  // 대표는 문항 많은 쪽(p-rep)이지만, 사용자가 응시한 건 p-real 이다.
  const db = new FakeSupabase({
    exam_papers: [paper("p-rep", "전산서기보"), paper("p-real", "사서서기보")],
    user_question_status: [status("p-real", 7)],
    questions: [
      { id: "q1", paper_id: "p-rep", question_number: 1 },
      { id: "q2", paper_id: "p-rep", question_number: 2 },
    ],
  });

  const out = await resolveStatusTargets(asSupabase(db), USER, [
    { paperId: "p-rep", questionNumber: 7 },
  ]);

  assert.deepEqual(out.get("p-rep#7"), ["p-real"]);
});

test("두 문제지 모두 응시했으면 둘 다 갱신 대상이다", async () => {
  const db = new FakeSupabase({
    exam_papers: [paper("p-a", "전산서기보"), paper("p-b", "사서서기보")],
    user_question_status: [status("p-a", 7), status("p-b", 7)],
    questions: [],
  });

  const out = await resolveStatusTargets(asSupabase(db), USER, [
    { paperId: "p-a", questionNumber: 7 },
  ]);

  assert.deepEqual([...(out.get("p-a#7") ?? [])].sort(), ["p-a", "p-b"]);
});

test("상태 행이 없는 문항은 담지 않는다 (호출부가 넘어온 id 를 그대로 쓴다)", async () => {
  const db = new FakeSupabase({
    exam_papers: [paper("p-rep", "전산서기보"), paper("p-real", "사서서기보")],
    // 7번만 응시 기록이 있고 12번은 없다(첫 기록).
    user_question_status: [status("p-real", 7)],
    questions: [],
  });

  const out = await resolveStatusTargets(asSupabase(db), USER, [
    { paperId: "p-rep", questionNumber: 7 },
    { paperId: "p-rep", questionNumber: 12 },
  ]);

  assert.deepEqual(out.get("p-rep#7"), ["p-real"]);
  assert.equal(out.has("p-rep#12"), false);
});

test("다른 사용자의 상태 행으로는 되짚지 않는다", async () => {
  const db = new FakeSupabase({
    exam_papers: [paper("p-rep", "전산서기보"), paper("p-real", "사서서기보")],
    user_question_status: [
      { user_id: "user-2", paper_id: "p-real", question_number: 7 },
    ],
    questions: [],
  });

  const out = await resolveStatusTargets(asSupabase(db), USER, [
    { paperId: "p-rep", questionNumber: 7 },
  ]);

  assert.equal(out.size, 0);
});

test("급수·회차가 다르면 같은 시험지로 묶지 않는다", async () => {
  const db = new FakeSupabase({
    exam_papers: [
      paper("p-9", "전산서기보"),
      paper("p-7", "사서서기보", { level: "7" }),
    ],
    user_question_status: [status("p-7", 7)],
    questions: [],
  });

  const out = await resolveStatusTargets(asSupabase(db), USER, [
    { paperId: "p-9", questionNumber: 7 },
  ]);

  assert.equal(out.size, 0);
});
