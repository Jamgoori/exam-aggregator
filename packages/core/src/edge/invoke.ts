// Edge Function 호출 하나 — 앱 lib 6곳의 `toError/unwrap` 복사본을 대체한다(설계서 §3.4 2번,
// §6.8 `edge/invoke.ts`). 성공이면 `EdgeContracts[N]["response"]` 를 그대로, 실패면
// `EdgeError { status, code?, message }` 를 던진다(§6.9 오류 타입). 서버의 `{ error }` 문구는
// 그대로 message 가 된다 — 웹 서버 액션과 같은 문장을 앱이 다시 쓰지 않는다.
//
// supabase-js(2.110.x, @supabase/functions-js) 의 invoke 는 throw 하지 않고 `{ data, error,
// response }` 를 돌려준다. error 는 세 가지:
//   FunctionsHttpError  — 함수가 non-2xx 를 돌려줌. `error.context` 가 원본 `Response`
//                         (`new FunctionsHttpError(response)`) 라 status·json() 을 여기서 읽는다.
//   FunctionsRelayError — 릴레이 실패(`x-relay-error: true`). context 는 Response 지만 HTTP 계약
//                         밖이라 status 0.
//   FunctionsFetchError — fetch 자체가 실패(오프라인·DNS·AbortSignal). context 는 fetch 가 던진 값.
// 세 클래스를 값으로 import 하면 core 에 supabase-js 런타임이 섞여 Edge 번들이 이중 로드된다
// (docs/agents/edge-core-bundle.md 금지선) — 그래서 `error.name` 과 context 모양으로만 가른다.
//
// 2xx 인데 본문이 `{ error }` 인 경우(ai-diagnose 의 202 "생성 중")는 supabase-js 가 성공으로
// 주므로, 응답 status 를 붙여 EdgeError 로 바꾼다. 성공 응답 중 `error` 키를 가진 계약은 없다.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeContracts, EdgeErrorCode, EdgeName } from "./contracts";

export const EDGE_UPDATE_REQUIRED: EdgeErrorCode = "update-required";

export class EdgeError extends Error {
  // HTTP 상태. 네트워크·릴레이·중단은 0.
  readonly status: number;
  // "update-required"(426) · "aborted"(AbortSignal) · "network"(fetch/릴레이 실패). 그 외 undefined.
  readonly code?: EdgeErrorCode;

  constructor(message: string, status: number, code?: EdgeErrorCode) {
    super(message);
    this.name = "EdgeError";
    this.status = status;
    if (code) this.code = code;
  }
}

export function isEdgeError(e: unknown): e is EdgeError {
  return e instanceof EdgeError;
}

export type InvokeEdgeOptions = {
  signal?: AbortSignal;
  headers?: Record<string, string>;
};

// invokeEdge 가 클라이언트에서 쓰는 부분만. `SupabaseClient` 가 이 모양을 만족한다(테스트의
// 컴파일 검사) — 테스트·다른 런타임이 가짜 클라이언트를 쉽게 넣을 수 있게 구조적으로 둔다.
export type EdgeInvokeClient = {
  functions: {
    invoke(
      name: string,
      options?: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal },
    ): Promise<{ data: unknown; error: unknown; response?: Response }>;
  };
};

// SupabaseClient.functions 는 FunctionsClient(protected 멤버가 있는 클래스)라 구조 타입으로
// 바로 받으면 가짜 클라이언트를 못 넣는다. 그래서 둘 다 허용한다.
export type EdgeClient = SupabaseClient | EdgeInvokeClient;

const FALLBACK_MESSAGE = "요청에 실패했어요. 잠시 후 다시 시도해 주세요.";
const NETWORK_MESSAGE = "네트워크에 연결할 수 없어요. 연결을 확인하고 다시 시도해 주세요.";
const ABORTED_MESSAGE = "요청이 취소됐어요.";

export async function invokeEdge<N extends EdgeName>(
  client: EdgeClient,
  name: N,
  body: EdgeContracts[N]["request"],
  opts: InvokeEdgeOptions = {},
): Promise<EdgeContracts[N]["response"]> {
  const { data, error, response } = await (client as EdgeInvokeClient).functions.invoke(name, {
    body,
    headers: opts.headers,
    signal: opts.signal,
  });

  if (error) throw await toEdgeError(error);

  // 2xx + `{ error }` (ai-diagnose 202) — 계약상 오류다.
  const bodyError = errorMessageOf(data);
  if (bodyError !== null) {
    const code = bodyError === EDGE_UPDATE_REQUIRED ? EDGE_UPDATE_REQUIRED : undefined;
    throw new EdgeError(bodyError, response?.status ?? 200, code);
  }

  return data as EdgeContracts[N]["response"];
}

// ── 내부 ────────────────────────────────────────────────────────────────────

type ResponseLike = { status: number; json(): Promise<unknown> };

function isResponseLike(v: unknown): v is ResponseLike {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as ResponseLike).status === "number" &&
    typeof (v as ResponseLike).json === "function"
  );
}

// `{ error: string }` 본문이면 그 문구, 아니면 null.
function errorMessageOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const e = (body as { error?: unknown }).error;
  return typeof e === "string" && e.length > 0 ? e : null;
}

// AbortSignal 로 끊긴 fetch 가 던지는 이름. 수동 abort 는 "AbortError", `AbortSignal.timeout()` 은
// "TimeoutError"(DOMException) — 둘 다 "응답을 못 받았다"이지 네트워크 단절이 아니다(§6.6: CBT
// 제출은 이 경우 재제출 대신 recoverAttempt 로 복원해야 한다).
const ABORT_NAMES = new Set(["AbortError", "TimeoutError"]);

function nameOf(v: unknown): unknown {
  return typeof v === "object" && v !== null ? (v as { name?: unknown }).name : undefined;
}

// Expo(winter) fetch 는 원본을 `FetchError { cause: signal.reason }` 로 감싸고, 그것을 functions-js 가
// 다시 FunctionsFetchError.context 에 넣는다 — 이름을 context 자체와 cause 사슬에서 찾는다.
function isAbortError(v: unknown, depth = 0): boolean {
  if (typeof v !== "object" || v === null || depth > 3) return false;
  const name = nameOf(v);
  if (typeof name === "string" && ABORT_NAMES.has(name)) return true;
  return isAbortError((v as { cause?: unknown }).cause, depth + 1);
}

async function toEdgeError(error: unknown): Promise<EdgeError> {
  const name = nameOf(error);
  const context = typeof error === "object" && error !== null ? (error as { context?: unknown }).context : undefined;

  // fetch 실패(오프라인·DNS·중단). context 는 fetch 가 던진 원본 오류.
  if (name === "FunctionsFetchError") {
    return isAbortError(context)
      ? new EdgeError(ABORTED_MESSAGE, 0, "aborted")
      : new EdgeError(NETWORK_MESSAGE, 0, "network");
  }
  // fetch 가 감싸지 않고 그대로 올라온 중단·타임아웃(폴리필 fetch 가 throw 한 경우).
  if (isAbortError(error)) return new EdgeError(ABORTED_MESSAGE, 0, "aborted");
  // 릴레이 실패 — 함수까지 못 갔으니 HTTP 계약 밖.
  if (name === "FunctionsRelayError") return new EdgeError(NETWORK_MESSAGE, 0, "network");

  // FunctionsHttpError(또는 같은 모양의 무엇) — context 가 Response.
  if (isResponseLike(context)) {
    const status = context.status;
    let message: string | null = null;
    try {
      message = errorMessageOf(await context.json());
    } catch {
      // JSON 이 아닌 본문(게이트웨이 HTML 등) — 상태만 남긴다.
    }
    const code: EdgeErrorCode | undefined = status === 426 ? EDGE_UPDATE_REQUIRED : undefined;
    return new EdgeError(message ?? `${FALLBACK_MESSAGE} (${status})`, status, code);
  }

  // 알 수 없는 오류 — 메시지만 살리고 네트워크로 본다.
  const message = error instanceof Error && error.message ? error.message : FALLBACK_MESSAGE;
  return new EdgeError(message, 0, "network");
}
