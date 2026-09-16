import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient, type Row } from "../test-support/fake-supabase";
import {
  AnthropicRequestError,
  collectDiagnosisBatches,
  collectDiagnosisForUser,
  submitPendingDiagnoses,
  type AnthropicBatchTransport,
  type DiagnosisBatchRequest,
  type DiagnosisBatchResultLine,
} from "./diagnosis-batch";

// 배치 제출·수거에서 **돈이 새거나 남의 것이 섞이는 자리**만 고정한다. 여기서 어긋나면
// 드러나는 곳이 화면이 아니라 청구서다:
//   · 같은 진단에 배치가 두 번 나가면 요금이 두 배(제출 선점)
//   · 끝나지도 않은 배치의 결과를 내려받으면 느리고 비싸다
//   · 같은 배치를 두 번 합치면 리포트가 덮이거나 반쪽이 된다(수거 선점)
//   · 한 배치에 여러 사용자가 실리므로, 남의 custom_id 줄을 주우면 남의 진단이 섞인다
//   · 일시적 오류(429·5xx)에 배치를 닫아 버리면 이미 낸 요금을 버리고 다시 낸다

const USER = "user-1";
const OTHER = "user-2";
const DIAG = "11111111-1111-4111-8111-111111111111";
const OTHER_DIAG = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-16T04:00:00Z");

function coachingJson(concept: string): string {
  return JSON.stringify({
    items: [{ concept, weakPattern: "조건절을 건너뛴다.", howToOvercome: "조건절에 밑줄." }],
  });
}

function contextFor(concept: string): Row {
  return {
    report: { summary: "요약", weakConcepts: [], subjectTrends: [], mission: null, insights: null },
    targets: [{ concept, conceptId: null, subject: "국어", subjectSlug: "korean" }],
  };
}

// 진단 하나가 배치에 실려 처리 중인 상태. `-infinity` 는 "아직 아무도 확인하지 않았다"
// (schema.sql 의 last_checked_at 기본값과 같은 값).
function batchTables(overrides: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    ai_diagnoses: [
      {
        id: DIAG,
        user_id: USER,
        diagnosis_date: "2026-09-16",
        report: null,
        selected_concepts: null,
        batch_claimed_at: "-infinity",
      },
      {
        id: OTHER_DIAG,
        user_id: OTHER,
        diagnosis_date: "2026-09-16",
        report: null,
        selected_concepts: null,
        batch_claimed_at: "-infinity",
      },
    ],
    ai_diagnosis_batches: [
      {
        id: "b1",
        diagnosis_id: DIAG,
        user_id: USER,
        batch_id: "msgbatch_1",
        custom_id: DIAG,
        model: "claude-opus-5",
        context: contextFor("문장 성분"),
        status: "pending",
        error: null,
        requested_at: "2026-09-16T03:00:00Z",
        completed_at: null,
        last_checked_at: "-infinity",
      },
      // 같은 배치에 실린 **다른 사용자**의 진단. 크론 경로는 한 배치에 25명까지 싣는다.
      {
        id: "b2",
        diagnosis_id: OTHER_DIAG,
        user_id: OTHER,
        batch_id: "msgbatch_1",
        custom_id: OTHER_DIAG,
        model: "claude-opus-5",
        context: contextFor("남의 개념"),
        status: "pending",
        error: null,
        requested_at: "2026-09-16T03:00:00Z",
        completed_at: null,
        last_checked_at: "-infinity",
      },
    ],
    ...overrides,
  };
}

type TransportLog = {
  created: DiagnosisBatchRequest[][];
  retrieved: string[];
  downloaded: string[];
};

function fakeTransport(opts: {
  processingStatus?: string;
  lines?: DiagnosisBatchResultLine[];
  retrieveError?: unknown;
}): { transport: AnthropicBatchTransport; log: TransportLog } {
  const log: TransportLog = { created: [], retrieved: [], downloaded: [] };
  const transport: AnthropicBatchTransport = {
    async create(requests) {
      log.created.push(requests);
      return { id: `msgbatch_new_${log.created.length}` };
    },
    async retrieve(batchId) {
      log.retrieved.push(batchId);
      if (opts.retrieveError) throw opts.retrieveError;
      return {
        processingStatus: opts.processingStatus ?? "in_progress",
        resultsUrl: `https://api.anthropic.com/v1/messages/batches/${batchId}/results`,
      };
    },
    results(batchId) {
      const lines = opts.lines ?? [];
      log.downloaded.push(batchId);
      return {
        async *[Symbol.asyncIterator]() {
          for (const line of lines) yield line;
        },
      };
    },
  };
  return { transport, log };
}

function succeeded(customId: string, concept: string): DiagnosisBatchResultLine {
  return {
    custom_id: customId,
    result: { type: "succeeded", message: { content: [{ type: "text", text: coachingJson(concept) }] } },
  };
}

// ── 수거 ────────────────────────────────────────────────────────────────────

test("끝나지 않은 배치는 결과를 내려받지 않는다", async () => {
  const db = new FakeSupabase(batchTables());
  const { transport, log } = fakeTransport({ processingStatus: "in_progress" });
  const out = await collectDiagnosisBatches(asClient(db), { userId: USER }, { transport, now: NOW });

  assert.deepEqual(out, { ready: 0, failed: 0, pending: 1 });
  assert.deepEqual(log.retrieved, ["msgbatch_1"]);
  // 내려받기는 비싸고 느리다 — ended 이전에는 건드리지 않는다.
  assert.deepEqual(log.downloaded, []);
});

test("재확인 간격 안에 다시 부르면 Anthropic 을 두드리지 않는다", async () => {
  const db = new FakeSupabase(batchTables());
  const { transport, log } = fakeTransport({ processingStatus: "in_progress" });
  const deps = { transport, now: NOW };

  await collectDiagnosisBatches(asClient(db), { userId: USER }, deps);
  // 같은 시각에 곧바로 한 번 더(앱이 폴링하는 상황).
  const second = await collectDiagnosisBatches(asClient(db), { userId: USER }, deps);

  assert.equal(log.retrieved.length, 1, "두 번째 호출은 선점에 실패해 조회 자체를 하지 않는다");
  assert.equal(second.pending, 1);
});

test("수거는 내 custom_id 줄만 줍는다 — 같은 배치의 남의 결과는 저장하지 않는다", async () => {
  const db = new FakeSupabase(batchTables());
  const { transport, log } = fakeTransport({
    processingStatus: "ended",
    lines: [
      succeeded(`${OTHER_DIAG}_0`, "남의 개념"),
      succeeded(`${DIAG}_0`, "문장 성분"),
    ],
  });

  const out = await collectDiagnosisBatches(asClient(db), { userId: USER }, { transport, now: NOW });

  assert.deepEqual(out, { ready: 1, failed: 0, pending: 0 });
  assert.deepEqual(log.downloaded, ["msgbatch_1"]);

  const mine = db.rowsOf("ai_diagnoses").find((r) => r.id === DIAG);
  const theirs = db.rowsOf("ai_diagnoses").find((r) => r.id === OTHER_DIAG);
  assert.equal((mine?.report as { conceptCoaching?: unknown[] })?.conceptCoaching?.length, 1);
  // 남의 진단은 손대지 않는다 — 그 사람의 배치 행은 여전히 pending 이다.
  assert.equal(theirs?.report, null);
  assert.equal(db.rowsOf("ai_diagnosis_batches").find((r) => r.id === "b2")?.status, "pending");
});

test("이미 저장된 리포트를 두 번째 수거가 덮지 않는다", async () => {
  const tables = batchTables();
  (tables.ai_diagnoses[0] as Row).report = { summary: "먼저 저장된 것", conceptCoaching: [] };
  const db = new FakeSupabase(tables);
  const { transport } = fakeTransport({
    processingStatus: "ended",
    lines: [succeeded(`${DIAG}_0`, "문장 성분")],
  });

  await collectDiagnosisBatches(asClient(db), { userId: USER }, { transport, now: NOW });

  const mine = db.rowsOf("ai_diagnoses").find((r) => r.id === DIAG);
  assert.equal((mine?.report as { summary: string }).summary, "먼저 저장된 것");
});

test("끝난 배치를 합치기 전에 선점을 연장한다 — 내려받는 도중에 다른 호출이 집지 못하게", async () => {
  const db = new FakeSupabase(batchTables());
  // 저장만 실패시켜 행을 pending 으로 남긴다(합치는 도중과 같은 상태).
  db.failNext.set("ai_diagnoses", "저장 실패");
  const { transport } = fakeTransport({
    processingStatus: "ended",
    lines: [succeeded(`${DIAG}_0`, "문장 성분")],
  });

  const out = await collectDiagnosisBatches(asClient(db), { userId: USER }, { transport, now: NOW });

  assert.equal(out.pending, 1, "저장 실패는 pending 으로 둔다 — 다음 수거가 같은 결과를 다시 읽는다");
  const row = db.rowsOf("ai_diagnosis_batches").find((r) => r.id === "b1");
  assert.equal(row?.status, "pending");
  // 재확인 간격(20초)이 지나도 못 집게 미래로 밀려 있어야 한다.
  assert.ok(
    Date.parse(String(row?.last_checked_at)) > NOW.getTime(),
    "합치는 동안 last_checked_at 이 미래로 밀려 있어야 한다",
  );
});

test("일시적 오류(429)는 배치를 닫지 않는다 — 닫으면 이미 낸 요금을 버린다", async () => {
  const db = new FakeSupabase(batchTables());
  const { transport } = fakeTransport({
    retrieveError: new AnthropicRequestError("Anthropic GET /x → 429", 429),
  });

  const out = await collectDiagnosisBatches(asClient(db), { userId: USER }, { transport, now: NOW });

  assert.deepEqual(out, { ready: 0, failed: 0, pending: 1 });
  assert.equal(db.rowsOf("ai_diagnosis_batches").find((r) => r.id === "b1")?.status, "pending");
});

test("404 라도 배치 SLA(24시간) 전에는 닫지 않는다 — 수거 키가 둘이라 멀쩡한 배치가 404 로 보인다", async () => {
  // 웹 크론(Vercel 키)과 Edge(Supabase secret 키)가 다른 워크스페이스로 설정되면 한쪽이 낸
  // 배치가 다른 쪽에는 없는 것으로 보인다. 그때 바로 닫으면 이미 요금을 낸, 지금도 돌고 있는
  // 배치를 버리고 같은 진단을 다시 제출한다(요금 두 배).
  const db = new FakeSupabase(batchTables()); // requested_at = NOW − 1시간
  const { transport } = fakeTransport({
    retrieveError: new AnthropicRequestError("Anthropic GET /x → 404", 404),
  });

  const out = await collectDiagnosisBatches(asClient(db), { userId: USER }, { transport, now: NOW });

  assert.deepEqual(out, { ready: 0, failed: 0, pending: 1 });
  assert.equal(db.rowsOf("ai_diagnosis_batches").find((r) => r.id === "b1")?.status, "pending");
});

test("SLA 를 넘긴 404 는 실패로 닫는다 — 영원히 기다리지 않게", async () => {
  const tables = batchTables();
  (tables.ai_diagnosis_batches[0] as Row).requested_at = new Date(
    NOW.getTime() - 25 * 3_600_000,
  ).toISOString();
  const db = new FakeSupabase(tables);
  const { transport } = fakeTransport({
    retrieveError: new AnthropicRequestError("Anthropic GET /x → 404", 404),
  });

  const out = await collectDiagnosisBatches(asClient(db), { userId: USER }, { transport, now: NOW });

  assert.equal(out.failed, 1);
  const row = db.rowsOf("ai_diagnosis_batches").find((r) => r.id === "b1");
  assert.equal(row?.status, "failed");
  assert.equal(row?.error, "배치를 찾을 수 없어요.");
});

test("키가 없으면(transport null) 아무것도 하지 않는다", async () => {
  const db = new FakeSupabase(batchTables());
  const out = await collectDiagnosisBatches(
    asClient(db),
    { userId: USER },
    { transport: null, now: NOW },
  );
  assert.deepEqual(out, { ready: 0, failed: 0, pending: 0 });
  assert.equal(db.writes.length, 0);
});

// ── 한 사람의 수거(앱이 기다리는 동안 부르는 것) ────────────────────────────

test("collectDiagnosisForUser — 끝난 배치를 수거하면 ready 와 날짜를 돌려준다", async () => {
  const db = new FakeSupabase(batchTables());
  const { transport } = fakeTransport({
    processingStatus: "ended",
    lines: [succeeded(`${DIAG}_0`, "문장 성분")],
  });

  const out = await collectDiagnosisForUser(asClient(db), USER, { transport, now: NOW });

  assert.equal(out.status, "ready");
  assert.equal(out.date, "2026-09-16");
  assert.equal(out.conceptCount, 1);
});

test("collectDiagnosisForUser — 요청 행이 없으면 none(Anthropic 을 부르지 않는다)", async () => {
  const db = new FakeSupabase(batchTables({ ai_diagnoses: [], ai_diagnosis_batches: [] }));
  const { transport, log } = fakeTransport({ processingStatus: "ended" });

  const out = await collectDiagnosisForUser(asClient(db), USER, { transport, now: NOW });

  assert.equal(out.status, "none");
  assert.deepEqual(log.retrieved, []);
});

test("collectDiagnosisForUser — 아직 제출 전(배치 행 없음)이면 pending", async () => {
  const db = new FakeSupabase(batchTables({ ai_diagnosis_batches: [] }));
  const { transport, log } = fakeTransport({ processingStatus: "ended" });

  const out = await collectDiagnosisForUser(asClient(db), USER, { transport, now: NOW });

  // 실패가 아니라 대기다 — 시간당 크론이 제출을 주워 간다.
  assert.equal(out.status, "pending");
  assert.equal(out.date, "2026-09-16");
  assert.deepEqual(log.retrieved, []);
});

test("collectDiagnosisForUser — 남의 배치는 보지 않는다", async () => {
  const db = new FakeSupabase(batchTables());
  const { transport, log } = fakeTransport({ processingStatus: "in_progress" });

  await collectDiagnosisForUser(asClient(db), OTHER, { transport, now: NOW });

  // 조회는 남의 진단(OTHER_DIAG) 배치 하나뿐이고, 내 행(b1)은 건드려지지 않는다.
  assert.equal(db.rowsOf("ai_diagnosis_batches").find((r) => r.id === "b1")?.last_checked_at, "-infinity");
  assert.deepEqual(log.downloaded, []);
});

// ── 제출 ────────────────────────────────────────────────────────────────────

test("이미 배치에 실린 진단은 다시 제출하지 않는다", async () => {
  const db = new FakeSupabase(batchTables());
  const { transport, log } = fakeTransport({});

  const out = await submitPendingDiagnoses(asClient(db), { userId: USER }, { transport, now: NOW });

  assert.equal(out.submitted, 0);
  assert.deepEqual(log.created, [], "in-flight 행이 있으면 배치를 내지 않는다");
});

test("연타 — 이미 선점된 진단은 배치를 내지 않는다(요금 두 배 방지)", async () => {
  const tables = batchTables({ ai_diagnosis_batches: [] });
  // 방금 다른 호출이 제출을 시작했다(배치 행은 아직 없다 — 기록은 제출 **뒤**에 한다).
  (tables.ai_diagnoses[0] as Row).batch_claimed_at = NOW.toISOString();
  const db = new FakeSupabase(tables);
  const { transport, log } = fakeTransport({});

  const out = await submitPendingDiagnoses(asClient(db), { userId: USER }, { transport, now: NOW });

  assert.equal(out.submitted, 0);
  assert.deepEqual(log.created, [], "선점을 잡지 못한 호출은 배치를 내지 않는다");
  // 사람이 누른 요청(userId)에는 사유를 돌려준다 — 침묵하면 화면이 "요청했어요"라고 말한 뒤
  // 아무 일도 일어나지 않는다.
  assert.ok(out.error, "버튼 경로에는 사유가 있어야 한다");
});

test("선점은 시간이 지나면 풀린다 — 제출 도중 죽은 프로세스가 진단을 묶어 두지 않게", async () => {
  const tables = batchTables({ ai_diagnosis_batches: [] });
  // 5분 전에 누가 제출을 시작했다가 끝내지 못했다(SUBMIT_CLAIM_SECONDS = 120초).
  (tables.ai_diagnoses[0] as Row).batch_claimed_at = new Date(NOW.getTime() - 300_000).toISOString();
  const db = new FakeSupabase(tables);
  const { transport } = fakeTransport({});

  // 이 저장소에는 오답이 하나도 없으므로 제출은 "만들 게 없다"로 끝난다 — 여기서 보는 것은
  // 선점을 **가져왔는지**다(가져왔으면 batch_claimed_at 이 지금으로 밀린다).
  await submitPendingDiagnoses(asClient(db), { userId: USER }, { transport, now: NOW });

  assert.equal(db.rowsOf("ai_diagnoses").find((r) => r.id === DIAG)?.batch_claimed_at, NOW.toISOString());
});
