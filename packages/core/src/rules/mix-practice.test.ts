import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient as asSupabase } from "../test-support/fake-supabase";
import {
  buildMixPool,
  embedOne,
  toMixOverview,
  toMixSessionBriefs,
  type MixSessionRow,
} from "./mix-practice";

// 2026-09-05 프로덕션 사고: /mix 가 로그인 사용자에게만 500 이었다(익명은 CDN 캐시본을
// 받아 멀쩡해 보였다). 원인은 PostgREST 임베드가 배열로 와서 subjects.slug 가 조용히
// undefined 가 된 것 — 그 값이 색 해시(subjectColorIndex → undefined.length)로 들어가
// 페이지를 통째로 떨어뜨렸다. 임베드 모양은 조회마다 달라질 수 있으니 규칙을 못 박는다.

function row(over: Partial<MixSessionRow> = {}): MixSessionRow {
  return {
    id: "s1",
    created_at: "2026-09-05T09:00:00+09:00",
    score: 8,
    total_questions: 10,
    subjects: { slug: "korean", name: "국어" },
    ...over,
  };
}

test("임베드가 객체로 와도 배열로 와도 같은 결과", () => {
  const asObject = toMixSessionBriefs([row()], 5);
  const asArray = toMixSessionBriefs([row({ subjects: [{ slug: "korean", name: "국어" }] })], 5);
  assert.equal(asObject[0].subjectSlug, "korean");
  assert.deepEqual(asArray, asObject);
});

test("과목을 못 찾은 세션은 목록에서 빠진다 — slug 없이 그리면 화면이 죽는다", () => {
  const rows = [
    row({ id: "a", subjects: null }),
    row({ id: "b", subjects: [] }),
    row({ id: "c", subjects: { slug: "", name: "" } }),
    row({ id: "d" }),
  ];
  const briefs = toMixSessionBriefs(rows, 5);
  assert.deepEqual(briefs.map((b) => b.id), ["d"]);
  for (const b of briefs) assert.ok(b.subjectSlug.length > 0);
});

test("같은 날 순번은 표시 개수(limit)가 아니라 받아온 전체 기준으로 매긴다", () => {
  // limit 만큼 자른 뒤 이름을 붙이면, 최신 세션이 "(1)"로 보인다.
  const rows = [
    row({ id: "new", created_at: "2026-09-05T11:00:00+09:00" }),
    row({ id: "mid", created_at: "2026-09-05T10:00:00+09:00" }),
    row({ id: "old", created_at: "2026-09-05T09:00:00+09:00" }),
  ];
  const briefs = toMixSessionBriefs(rows, 1);
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0].id, "new");
  assert.equal(briefs[0].title, "9월 5일 섞어풀기 (3)");
});

test("embedOne: 배열이면 첫 항목, 비었거나 없으면 null", () => {
  assert.deepEqual(embedOne({ a: 1 }), { a: 1 });
  assert.deepEqual(embedOne([{ a: 1 }, { a: 2 }]), { a: 1 });
  assert.equal(embedOne([]), null);
  assert.equal(embedOne(null), null);
  assert.equal(embedOne(undefined), null);
});

// ── 출제 풀의 개념 조회 끄기(includeConcepts:false) ──────────────────────────
//
// Edge 에는 웹의 'use cache' 가 없어 mix-create overview / review-history 의 mix 기록 목록이
// 요청마다 풀을 다시 만든다. 개념(concept_id)은 출제 분산(pickMixQuestions)에만 쓰이고 그 두
// 곳에서는 전혀 쓰이지 않는데, 조회만 문항 200개당 한 왕복씩 붙는다. 끌 수 있게 해 두되
// **끈 풀에서도 화면 요약(toMixOverview)이 한 글자도 달라지지 않아야** 한다 — 달라지면
// 웹 시작 화면과 앱 시작 화면의 숫자가 갈린다.

function mixPoolFixture() {
  const papers = [
    {
      id: "p1",
      subject_id: "s1",
      exam_type_id: "e1",
      year: 2024,
      round: 1,
      level: "9급",
      track: null,
      title: "2024 국가직 9급 국어",
      created_at: "2024-04-01T00:00:00.000Z",
      exam_types: { name: "국가직" },
    },
    {
      id: "p2",
      subject_id: "s1",
      exam_type_id: "e1",
      year: 2023,
      round: 1,
      level: "9급",
      track: null,
      title: "2023 국가직 9급 국어",
      created_at: "2023-04-01T00:00:00.000Z",
      exam_types: { name: "국가직" },
    },
  ];
  const questions = [
    { id: "q1", paper_id: "p1", question_number: 1, question_images: [{ order_index: 0 }] },
    { id: "q2", paper_id: "p1", question_number: 2, question_images: [{ order_index: 0 }] },
    { id: "q3", paper_id: "p2", question_number: 1, question_images: [{ order_index: 0 }] },
  ];
  return new FakeSupabase({
    exam_papers: papers,
    // voided 는 없지만 행 자체는 있어야 "정답이 등록된 문제지"로 친다.
    paper_answers: [
      { paper_id: "p1", voided_questions: [] },
      { paper_id: "p2", voided_questions: [] },
    ],
    questions,
    // q1 의 개념은 합쳐진 개념(c-old → c1)이라, 켜 두면 정본 id 로 되짚어야 한다.
    question_explanations: [{ question_id: "q1", concept_id: "c-old" }],
    concepts: [
      { id: "c-old", merged_into: "c1" },
      { id: "c1", merged_into: null },
    ],
  });
}

test("includeConcepts 기본값은 개념을 읽고 merged_into 로 되짚는다", async () => {
  const db = mixPoolFixture();
  const pool = await buildMixPool(asSupabase(db), asSupabase(db), "s1");
  assert.equal(pool.candidates.length, 3);
  assert.equal(pool.candidates.find((c) => c.paperId === "p1" && c.questionNumber === 1)?.conceptId, "c1");
  assert.ok(db.reads.includes("question_explanations"), "개념 조회가 없었다");
});

test("includeConcepts:false 는 개념 조회를 통째로 건너뛴다 — 요약은 동일", async () => {
  const withConcepts = mixPoolFixture();
  const fullPool = await buildMixPool(asSupabase(withConcepts), asSupabase(withConcepts), "s1");

  const withoutConcepts = mixPoolFixture();
  const leanPool = await buildMixPool(asSupabase(withoutConcepts), asSupabase(withoutConcepts), "s1", {
    includeConcepts: false,
  });

  assert.equal(
    withoutConcepts.reads.includes("question_explanations"),
    false,
    "끈 풀이 question_explanations 를 읽었다",
  );
  assert.equal(withoutConcepts.reads.includes("concepts"), false, "끈 풀이 concepts 를 읽었다");
  // 후보 자체는 남고 conceptId 만 null 이다(분산만 사라진다 — 그래서 create 에는 쓰지 않는다).
  assert.equal(leanPool.candidates.length, fullPool.candidates.length);
  assert.ok(leanPool.candidates.every((c) => c.conceptId === null));
  assert.deepEqual(leanPool.repByPaperId, fullPool.repByPaperId);

  // 화면 요약은 한 글자도 달라지지 않는다.
  const subject = { id: "s1", slug: "korean", name: "국어", display_order: 1 };
  assert.deepEqual(toMixOverview(subject, leanPool), toMixOverview(subject, fullPool));
});
