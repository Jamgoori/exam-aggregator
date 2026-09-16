import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient as asSupabase, type Row } from "../test-support/fake-supabase";
import { requestDiagnosisForUser } from "./diagnosis-request";
import { normalizeConceptSelection } from "../diagnosis-report";

// AI 약점 진단 요청(Edge `diagnosis-request` + 웹 서버 액션이 함께 부르는 규칙).
//
// 여기서 지키는 것은 넷이다. 전부 **요금**이 걸린 판정이라, 하나라도 새면 요청 행 하나가
// 그대로 유료 모델 호출이 된다(크론이 report=null 인 행을 집어 Batches 에 싣는다):
//   1. 프리미엄이 아니면 행이 **생기지 않는다**(화면 잠금과 별개로 여기서도 막는다).
//   2. 자격(오답 15 ∨ 응시 3) 미달이면 행이 생기지 않는다.
//   3. 주기 안에 행이 있으면 새로 만들지 않는다 — 이미 받은 사람이 다시 눌러도 요금 0.
//   4. 개념 선택은 상한(10개)까지 잘려 **행에 박힌 값**이 정본이 된다(제출과 생성이
//      몇 시간 떨어져 있어, 나중에 다시 집계하면 사용자가 체크한 것과 달라진다).

const USER = "user-1";
const NOW = new Date("2026-09-16T04:00:00Z"); // KST 2026-09-16 13:00

// 자격을 채운 계정(응시 3회). 오답 행은 0이라 "둘 중 하나만 넘기면 된다"도 함께 본다.
function eligibleTables(extra: Partial<Record<string, Row[]>> = {}) {
  return {
    cbt_attempts: [
      { id: "a1", user_id: USER },
      { id: "a2", user_id: USER },
      { id: "a3", user_id: USER },
    ],
    user_question_status: [],
    ai_diagnoses: [],
    ...extra,
  };
}

function db(tables: Record<string, Row[]>) {
  return new FakeSupabase(tables, { primaryKeys: { ai_diagnoses: ["user_id", "diagnosis_date"] } });
}

test("프리미엄이 아니면 요청 행을 만들지 않는다", async () => {
  const fake = db(eligibleTables());
  const res = await requestDiagnosisForUser(
    asSupabase(fake),
    { userId: USER, premium: false, selectedConcepts: [{ conceptId: "c1", concept: "행정행위" }] },
    { getAdmin: () => asSupabase(fake), now: NOW },
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, "premium");
  assert.equal(res.ok === false && res.error, "AI 약점 진단은 멤버십 기능이에요.");
  assert.equal(fake.tables.ai_diagnoses.length, 0);
});

test("자격 미달이면 요청 행을 만들지 않고 '조금 더 풀면' 안내를 준다", async () => {
  const fake = db({ cbt_attempts: [{ id: "a1", user_id: USER }], user_question_status: [], ai_diagnoses: [] });
  const res = await requestDiagnosisForUser(
    asSupabase(fake),
    { userId: USER, premium: true },
    { getAdmin: () => asSupabase(fake), now: NOW },
  );
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, "not-eligible");
  assert.match(res.ok === false ? res.error : "", /오답 15개 또는 3회 응시/);
  assert.equal(fake.tables.ai_diagnoses.length, 0);
});

test("오답 15개만으로도 자격이 열린다(응시 0회)", async () => {
  const wrongs = Array.from({ length: 15 }, (_, i) => ({
    user_id: USER,
    paper_id: `p${i}`,
    question_number: i + 1,
    wrong_count: 1,
  }));
  const fake = db({ cbt_attempts: [], user_question_status: wrongs, ai_diagnoses: [] });
  const res = await requestDiagnosisForUser(
    asSupabase(fake),
    { userId: USER, premium: true },
    { getAdmin: () => asSupabase(fake), now: NOW },
  );
  assert.equal(res.ok, true);
  assert.equal(fake.tables.ai_diagnoses.length, 1);
});

test("요청 행은 KST 오늘 날짜로 만들고, 고른 개념을 상한까지 잘라 박는다", async () => {
  const fake = db(eligibleTables());
  // 12개를 보내지만 상한은 10개다. 중복(같은 conceptId)도 한 번만 남는다.
  const picked = [
    { conceptId: "c1", concept: "행정행위" },
    { conceptId: "c1", concept: "행정행위(중복)" },
    ...Array.from({ length: 11 }, (_, i) => ({ conceptId: `x${i}`, concept: `개념${i}` })),
  ];
  const res = await requestDiagnosisForUser(
    asSupabase(fake),
    { userId: USER, premium: true, selectedConcepts: picked },
    { getAdmin: () => asSupabase(fake), now: NOW },
  );
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.status, "pending");
  assert.equal(res.ok === true && res.date, "2026-09-16");
  // 주기가 풀리는 날 = 받은 날 + 7일.
  assert.equal(res.ok === true && res.nextDate, "2026-09-23");
  assert.equal(res.ok === true && res.selectedConcepts.length, 10);

  const row = fake.tables.ai_diagnoses[0];
  assert.equal(row.user_id, USER);
  assert.equal(row.diagnosis_date, "2026-09-16");
  assert.equal(row.report, null);
  assert.equal((row.selected_concepts as unknown[]).length, 10);
  assert.deepEqual(row.selected_concepts, normalizeConceptSelection(picked));
});

test("이번 주기에 이미 받았으면(ready) 새 행을 만들지 않고 선택도 덮지 않는다", async () => {
  const fake = db(
    eligibleTables({
      ai_diagnoses: [
        {
          id: "d1",
          user_id: USER,
          diagnosis_date: "2026-09-12",
          report: { summary: "…", weakConcepts: [], subjectTrends: [] },
          selected_concepts: [{ conceptId: "old", concept: "예전 선택" }],
        },
      ],
    }),
  );
  const res = await requestDiagnosisForUser(
    asSupabase(fake),
    { userId: USER, premium: true, selectedConcepts: [{ conceptId: "new", concept: "새 선택" }] },
    { getAdmin: () => asSupabase(fake), now: NOW },
  );
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.status, "ready");
  assert.equal(res.ok === true && res.diagnosisId, "d1");
  assert.equal(res.ok === true && res.nextDate, "2026-09-19");
  assert.equal(fake.tables.ai_diagnoses.length, 1);
  // 완성된 리포트의 선택은 건드리지 않는다.
  assert.deepEqual(fake.tables.ai_diagnoses[0].selected_concepts, [
    { conceptId: "old", concept: "예전 선택" },
  ]);
});

test("pending 으로 남은 요청을 다시 누르면 개념만 갈아 준다(행은 그대로)", async () => {
  const fake = db(
    eligibleTables({
      ai_diagnoses: [
        {
          id: "d1",
          user_id: USER,
          diagnosis_date: "2026-09-14",
          report: null,
          selected_concepts: [{ conceptId: "old", concept: "예전 선택" }],
        },
      ],
    }),
  );
  const res = await requestDiagnosisForUser(
    asSupabase(fake),
    { userId: USER, premium: true, selectedConcepts: [{ conceptId: "new", concept: "새 선택" }] },
    { getAdmin: () => asSupabase(fake), now: NOW },
  );
  assert.equal(res.ok, true);
  assert.equal(res.ok === true && res.status, "pending");
  assert.equal(fake.tables.ai_diagnoses.length, 1);
  assert.deepEqual(fake.tables.ai_diagnoses[0].selected_concepts, [
    { conceptId: "new", concept: "새 선택" },
  ]);
  // 호출부(웹 즉시 생성 경로)가 쓰는 "행에 실제로 박힌 목록"도 새 선택이어야 한다.
  assert.deepEqual(res.ok === true ? res.selectedConcepts : [], [
    { conceptId: "new", concept: "새 선택" },
  ]);
});

test("개념을 안 고르고 다시 누르면 행에 남아 있던 선택을 돌려준다", async () => {
  const fake = db(
    eligibleTables({
      ai_diagnoses: [
        {
          id: "d1",
          user_id: USER,
          diagnosis_date: "2026-09-14",
          report: null,
          selected_concepts: [{ conceptId: "old", concept: "예전 선택" }],
        },
      ],
    }),
  );
  const res = await requestDiagnosisForUser(
    asSupabase(fake),
    { userId: USER, premium: true },
    { getAdmin: () => asSupabase(fake), now: NOW },
  );
  assert.deepEqual(res.ok === true ? res.selectedConcepts : [], [
    { conceptId: "old", concept: "예전 선택" },
  ]);
});

test("남의 진단 행은 주기 판정에 들어오지 않는다", async () => {
  const fake = db(
    eligibleTables({
      ai_diagnoses: [
        { id: "other", user_id: "user-2", diagnosis_date: "2026-09-16", report: null, selected_concepts: null },
      ],
    }),
  );
  const res = await requestDiagnosisForUser(
    asSupabase(fake),
    { userId: USER, premium: true },
    { getAdmin: () => asSupabase(fake), now: NOW },
  );
  assert.equal(res.ok, true);
  assert.equal(fake.tables.ai_diagnoses.length, 2);
  assert.equal(fake.tables.ai_diagnoses.filter((r) => r.user_id === USER).length, 1);
});
