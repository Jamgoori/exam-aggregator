import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EdgeError, invokeEdge, isEdgeError, type EdgeInvokeClient } from "./invoke";

// invokeEdge 의 오류 변환 계약. supabase-js(functions-js 2.110.x) 는 throw 하지 않고
// `{ data, error, response }` 를 돌려주며, FunctionsHttpError.context 가 원본 Response 다 —
// 그 모양을 그대로 흉내 낸 가짜 클라이언트로 검사한다(값 import 금지라 클래스 대신 name 으로).

// SupabaseClient 가 EdgeInvokeClient 모양을 만족하는지 컴파일 시점에 고정한다.
// (SupabaseClient.functions 는 FunctionsClient 클래스 — 구조가 어긋나면 여기서 typecheck 가 깨진다.)
const _clientShape: EdgeInvokeClient = null as unknown as SupabaseClient;
void _clientShape;

type InvokeResult = { data: unknown; error: unknown; response?: Response };

function fakeClient(result: InvokeResult | (() => InvokeResult)) {
  const calls: { name: string; options: unknown }[] = [];
  const client: EdgeInvokeClient = {
    functions: {
      invoke: async (name, options) => {
        calls.push({ name, options });
        return typeof result === "function" ? result() : result;
      },
    },
  };
  return { client, calls };
}

// functions-js 가 만드는 오류와 같은 모양: Error 에 name 과 context 만 붙어 있다.
function functionsError(name: string, context: unknown): Error & { context: unknown } {
  const e = new Error(`${name} (fake)`) as Error & { context: unknown };
  e.name = name;
  e.context = context;
  return e;
}

function httpError(status: number, body: unknown, init: ResponseInit = {}) {
  const response = new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  return functionsError("FunctionsHttpError", response);
}

test("성공: data 를 그대로 돌려주고 name·body·headers·signal 을 invoke 에 넘긴다", async () => {
  const data = { success: true as const, startedAt: "2026-09-15T03:00:00.000Z" };
  const { client, calls } = fakeClient({ data, error: null });
  const ac = new AbortController();
  const out = await invokeEdge(client, "cbt-start", { paperId: "p1" }, {
    signal: ac.signal,
    headers: { "x-test": "1" },
  });
  assert.deepEqual(out, data);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "cbt-start");
  assert.deepEqual(calls[0].options, {
    body: { paperId: "p1" },
    headers: { "x-test": "1" },
    signal: ac.signal,
  });
});

test("FunctionsHttpError: Response context 의 status 와 JSON {error} 문구가 EdgeError 가 된다", async () => {
  const { client } = fakeClient({
    data: null,
    error: httpError(401, { error: "로그인 후 이용할 수 있어요." }),
  });
  await assert.rejects(
    invokeEdge(client, "membership-get", {}),
    (e: unknown) => {
      assert.ok(isEdgeError(e));
      assert.ok(e instanceof EdgeError);
      assert.equal(e.name, "EdgeError");
      assert.equal(e.status, 401);
      assert.equal(e.message, "로그인 후 이용할 수 있어요.");
      assert.equal(e.code, undefined);
      return true;
    },
  );
});

test("FunctionsHttpError 400: 규칙 거절 문구를 그대로 보존한다(웹 파리티)", async () => {
  const { client } = fakeClient({
    data: null,
    error: httpError(400, { error: "이미 채점된 세션이에요." }),
  });
  await assert.rejects(
    invokeEdge(client, "review-submit", { sessionId: "s1", answers: [1, null] }),
    (e: EdgeError) => e.status === 400 && e.message === "이미 채점된 세션이에요.",
  );
});

test("426 → code update-required", async () => {
  const { client } = fakeClient({
    data: null,
    error: httpError(426, { error: "update-required" }),
  });
  await assert.rejects(
    invokeEdge(client, "cbt-submit", { paperId: "p1", answers: [] }),
    (e: EdgeError) => e.status === 426 && e.code === "update-required" && e.message === "update-required",
  );
});

test("HTTP 오류 본문이 JSON 이 아니면 상태만 남기고 기본 문구를 쓴다", async () => {
  const { client } = fakeClient({
    data: null,
    error: httpError(500, "<html>bad gateway</html>", { headers: { "Content-Type": "text/html" } }),
  });
  await assert.rejects(
    invokeEdge(client, "account-delete", {}),
    (e: EdgeError) => e.status === 500 && e.code === undefined && e.message.includes("(500)"),
  );
});

test("FunctionsFetchError(네트워크) → status 0, code network", async () => {
  const { client } = fakeClient({
    data: null,
    error: functionsError("FunctionsFetchError", new TypeError("fetch failed")),
  });
  await assert.rejects(
    invokeEdge(client, "explanations-get", { paperId: "p1" }),
    (e: EdgeError) => e.status === 0 && e.code === "network",
  );
});

test("FunctionsFetchError(AbortError) → status 0, code aborted", async () => {
  const abort = new Error("The operation was aborted");
  abort.name = "AbortError";
  const { client } = fakeClient({ data: null, error: functionsError("FunctionsFetchError", abort) });
  await assert.rejects(
    invokeEdge(client, "explanations-get", { paperId: "p1" }),
    (e: EdgeError) => e.status === 0 && e.code === "aborted",
  );
});

test("FunctionsRelayError → status 0 (context 가 Response 여도 HTTP 계약 밖)", async () => {
  const relay = new Response("relay", { status: 502, headers: { "x-relay-error": "true" } });
  const { client } = fakeClient({ data: null, error: functionsError("FunctionsRelayError", relay) });
  await assert.rejects(
    invokeEdge(client, "review-history", {}),
    (e: EdgeError) => e.status === 0 && e.code === "network",
  );
});

test("정체불명 오류 → status 0, 메시지는 살린다", async () => {
  const { client } = fakeClient({ data: null, error: new Error("boom") });
  await assert.rejects(
    invokeEdge(client, "review-history", {}),
    (e: EdgeError) => e.status === 0 && e.message === "boom",
  );
});

test("2xx 인데 본문이 {error} 면(ai-diagnose 202) 응답 status 로 EdgeError", async () => {
  const response = new Response("{}", { status: 202 });
  const { client } = fakeClient({
    data: { error: "진단을 생성하고 있어요. 잠시 후 다시 확인해주세요." },
    error: null,
    response,
  });
  await assert.rejects(
    invokeEdge(client, "ai-diagnose", {}),
    (e: EdgeError) => e.status === 202 && e.message.startsWith("진단을 생성하고 있어요"),
  );
});
