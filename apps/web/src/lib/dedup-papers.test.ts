import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asSupabase, type Row } from "@/lib/test-support/fake-supabase";
import { fetchPaperIdentitySignals } from "@/lib/dedup-papers";

// 중복 시험지 대표 선정의 1순위 타이브레이커가 "문항 많은 쪽"이라(core dedup-papers.ts
// isBetterRepresentative) 문항 수가 틀리면 목록에서 어느 카드가 보일지 — 제목과 링크가
// — 흔들린다. 즉 여기서 지키는 건 성능이 아니라 정확성이다.
//
// 예전 구현은 questions 를 문항 하나당 한 행씩 받아 셌고 페이징이 없었다. PostgREST
// 응답은 1000행에서 잘리므로, 겹치는 문제지가 25~40장만 넘으면(문항이 장당 25~40개다)
// 뒤쪽 문제지가 조용히 0으로 집계됐다.

function papersWithQuestions(counts: Record<string, number>): Row[] {
  const rows: Row[] = [];
  for (const [paperId, n] of Object.entries(counts)) {
    for (let i = 1; i <= n; i++) rows.push({ paper_id: paperId, question_number: i });
  }
  return rows;
}

// 문제지 40장 × 문항 30개 = 1,200행. 예전 구현이라면 1000행에서 잘려 뒤쪽 문제지가
// 0으로 잡히는 규모다.
const PAPER_IDS = Array.from({ length: 40 }, (_, i) => `paper-${String(i).padStart(2, "0")}`);
const COUNTS = Object.fromEntries(PAPER_IDS.map((id) => [id, 30]));

test("RPC 가 있으면 문제지당 한 행으로 문항 수를 받는다", async () => {
  const fake = new FakeSupabase({ questions: papersWithQuestions(COUNTS) });
  fake.rpcHandlers["paper_question_counts"] = (args) => {
    const ids = (args.p_paper_ids ?? []) as string[];
    return ids.map((id) => ({ paper_id: id, question_count: COUNTS[id] ?? 0 }));
  };

  const signals = await fetchPaperIdentitySignals(asSupabase(fake), PAPER_IDS);

  assert.equal(signals.size, PAPER_IDS.length);
  for (const id of PAPER_IDS) {
    assert.equal(signals.get(id)?.questionCount, 30, `${id} 의 문항 수`);
  }
  assert.ok(fake.reads.includes("rpc:paper_question_counts"));
});

test("RPC 가 없는 환경(마이그레이션 전)에서도 1000행에서 잘리지 않는다", async () => {
  // rpcHandlers 를 비워 두면 FakeSupabase 가 "그런 함수 없음" 에러를 돌려준다.
  const fake = new FakeSupabase({ questions: papersWithQuestions(COUNTS) });

  const signals = await fetchPaperIdentitySignals(asSupabase(fake), PAPER_IDS);

  const total = PAPER_IDS.reduce((sum, id) => sum + (signals.get(id)?.questionCount ?? 0), 0);
  assert.equal(total, 1200, "1,200 문항이 전부 잡혀야 한다 (예전 구현은 1000에서 잘렸다)");
  for (const id of PAPER_IDS) {
    assert.equal(signals.get(id)?.questionCount, 30, `${id} 의 문항 수`);
  }
});

test("문항이 하나도 없는 문제지는 0 으로 남는다", async () => {
  const fake = new FakeSupabase({ questions: papersWithQuestions({ "paper-a": 20 }) });
  const signals = await fetchPaperIdentitySignals(asSupabase(fake), ["paper-a", "paper-b"]);
  assert.equal(signals.get("paper-a")?.questionCount, 20);
  assert.equal(signals.get("paper-b")?.questionCount, 0);
});

test("빈 목록이면 조회하지 않는다", async () => {
  const fake = new FakeSupabase({ questions: [] });
  const signals = await fetchPaperIdentitySignals(asSupabase(fake), []);
  assert.equal(signals.size, 0);
  assert.deepEqual(fake.reads, []);
});
