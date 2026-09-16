import type { SupabaseClient } from "@supabase/supabase-js";
import { DIAGNOSIS_CYCLE_DAYS } from "../data/home";
import { DIAGNOSIS_MODEL_DEFAULT, type DiagnosisMessageParams } from "../diagnosis-coach";
import {
  batchCustomId,
  mergeConceptResults,
  parseBatchCustomId,
  type ConceptResult,
} from "../diagnosis-batch-merge";
import type { AiDiagnosisReport, DiagnosisConceptSelection } from "../diagnosis-report";
import { getExcludedDiagnosisSubjectSlugs } from "./review-preferences";
import { planCoaching, saveDiagnosisReport } from "./diagnosis-generate";
import { getWeeklyDiagnosis } from "./diagnosis-request";

// 맞춤 극복법을 Message Batches API 로 만든다 — **제출**과 **수거**.
//
// 왜 배치인가: 진단은 주 1회짜리라 "지금 당장 20초 안에"가 요구사항이 아니다. 배치는
// 같은 모델·같은 프롬프트를 **절반 요금**으로 처리하고(비동기, 24시간 안에 완료 보장),
// 여러 사용자의 요청을 한 번에 밀어 넣을 수 있다. 동기 `/v1/messages` 로 바꾸면 요금이
// 그대로 2배가 된다 — 소유자가 거절한 선택지다. 어떤 이유로도 동기 호출로 바꾸지 말 것.
//
// 배치 안에서는 **개념 하나가 요청 하나**다(planCoaching 이 그렇게 갈라 준다). 진단 하나를
// 요청 하나(개념 10개)로 내던 때는 모델이 개념을 앞에서부터 차례로 쓰느라 생성 시간이
// 개념 수에 정비례했다. 배치는 요청들을 동시에 처리하므로 개념별로 갈라 내면 전체가 가장
// 오래 걸리는 개념 하나 시간으로 줄고, 프롬프트·모델·effort 는 그대로라 품질은 같다.
// 한 진단의 요청들은 같은 배치에 함께 실린다 — 배치는 끝나야 결과를 읽을 수 있으니,
// 진단 하나의 결과는 여전히 한 번에 온다.
//
// 배치 요금은 토큰 단위라 **요청 1건짜리 배치도 100건짜리와 단가가 같다.** 그래서 사용자가
// 누른 그 순간 그 사람 것만 배치 1건으로 내도 손해가 없다 — 웹 `lib/diagnosis-batch.ts`
// 에서 이 파일로 옮긴 이유가 그것이다. 이제 세 경로가 **같은 함수**를 부른다:
//   · 웹 서버 액션 `requestDiagnosis`  — 눌린 자리에서 제출
//   · Edge `diagnosis-request`          — 앱이 요청한 자리에서 제출(옛 경로는 크론을 기다렸다)
//   · 웹 크론 `/api/cron/diagnosis`     — 안전망. 앱을 닫은 사용자·제출 실패분을 매시간 줍는다
// 수거도 같다: 웹 진단 페이지·Edge `diagnosis-collect`·크론이 이 파일의 수거를 부른다.
//
// 상태는 ai_diagnosis_batches 에 남는다(supabase/schema.sql) — 진단 하나에 행 하나이고,
// 그 진단의 요청들은 custom_id 접두(진단 행 id)로 묶인다. 제출 시점의 무AI 리포트와
// "무엇을 물어봤는지"(대상 개념 목록)를 그 행에 저장해 두는 이유는, 수거가 몇 시간 뒤에
// 일어나기 때문이다 — 그 사이에 사용자가 문제를 더 풀면 다시 집계한 결과는 프롬프트와
// 어긋난다. 질문과 답이 같은 데이터를 보게 하려면 질문할 때의 스냅샷을 들고 있어야 한다.
//
// **요금이 두 번 나갈 수 있는 자리는 셋이고, 셋 다 막는다**:
//   제출 중복 → `ai_diagnoses.batch_claimed_at` 선점(아래 claimForSubmit)
//   수거 중복 → `ai_diagnosis_batches.last_checked_at` 선점(아래 claimForCollect)
// 앞의 둘은 "update … where 조건 … returning" 한 문장이라, 동시에 들어온 둘 중 하나만
// 잡는다(§6.6 의 복습 세션 선점과 같은 수법). 못 잡은 쪽은 조용히 물러난다.
//   batch_id 분실 → 배치는 만들어졌는데 우리가 그 id 를 잃는 경우다. 그러면 요금은 나갔고
// 수거는 못 하는데 진단은 pending 이라 다음 제출이 같은 것을 또 만든다. 그 자리가 둘인데
// 각각 이렇게 막는다: POST 를 우리가 먼저 끊는 것 → 제출 전용 긴 타임아웃(createTimeoutMs),
// 기록 insert 실패 → 그 자리에서 배치 취소(transport.cancel).

// ── Anthropic Message Batches REST ──────────────────────────────────────────
//
// SDK 를 쓰지 않는 이유: 이 파일은 Deno 번들(_shared/core.mjs)로도 나간다. Anthropic SDK 를
// 번들에 넣으면 Edge 가 그걸 통째로 싣게 되고(번들 검사가 external import 를 막는다),
// 우리가 쓰는 것은 엔드포인트 세 개뿐이다. 옛 `ai-diagnose` EF 도 같은 이유로 REST 를 썼다.

const ANTHROPIC_BASE = "https://api.anthropic.com/v1/messages/batches";
const ANTHROPIC_VERSION = "2023-06-01";

// HTTP 상태를 들고 다니는 오류. 수거가 "이 배치는 영영 없다"와 "지금 잠깐 안 된다"를
// 갈라야 하기 때문이다 — 둘을 뭉쳐 실패로 닫으면, 일시적인 429/5xx 하나에 **이미 요금을
// 낸 배치**를 버리고 다음 제출이 같은 진단을 새로 만든다(요금 두 배). 앱이 폴링하면서
// 수거를 자주 부르는 지금은 그 확률이 크론만 돌던 때와 비교가 안 된다.
export class AnthropicRequestError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "AnthropicRequestError";
    this.status = status;
  }
}

// 영구 실패로 보고 배치 행을 닫아도 되는 상태. 404(배치가 없다)·401/403(키가 바뀌었다·
// 워크스페이스가 다르다)은 몇 번을 더 물어도 답이 같다. 나머지(429·5xx·타임아웃·네트워크)는
// 그대로 pending 으로 두고 다음 수거에서 다시 묻는다.
function isPermanentBatchError(e: unknown): boolean {
  const status = e instanceof AnthropicRequestError ? e.status : null;
  return status === 404 || status === 401 || status === 403;
}

// 배치 안의 요청 한 건. custom_id 는 영숫자·'_'·'-' 만 허용(64자 이내)이다.
export type DiagnosisBatchRequest = { custom_id: string; params: DiagnosisMessageParams };

// 결과 JSONL 의 한 줄. 순서는 보장되지 않는다 — **custom_id 로 맞춘다.**
export type DiagnosisBatchResultLine = {
  custom_id: string;
  result:
    | { type: "succeeded"; message: { content: { type: string; text?: string }[] } }
    | { type: "errored" | "canceled" | "expired" };
};

export type AnthropicBatchTransport = {
  // POST /v1/messages/batches
  create(requests: DiagnosisBatchRequest[]): Promise<{ id: string }>;
  // GET /v1/messages/batches/{id} — 토큰 요금이 없는 조회지만 레이트리밋은 있다.
  // resultsUrl 은 배치가 끝났을 때만 채워진다(아래 results 가 그대로 쓴다).
  retrieve(batchId: string): Promise<{ processingStatus: string; resultsUrl: string | null }>;
  // 결과 JSONL. 한 줄씩 흘려 읽는다 — 통째로 문자열에 담으면 사용자 25명짜리 배치에서
  // Edge 아이솔레이트 메모리를 그대로 먹는다.
  results(batchId: string, resultsUrl?: string | null): AsyncIterable<DiagnosisBatchResultLine>;
  // POST /v1/messages/batches/{id}/cancel — 낸 배치를 도로 취소한다. optional 인 이유는
  // 이것이 **안전망 전용**이기 때문이다(아래 insert 실패 자리에서만 부른다). 없는 transport
  // (테스트의 가짜)도 그대로 돌아야 한다.
  cancel?(batchId: string): Promise<void>;
};

export type AnthropicTransportOptions = {
  apiKey: string;
  // 한 번의 **조회** HTTP 호출에 허용할 시간. 수거는 결과 JSONL 을 내려받느라 길어질 수
  // 있는데, Edge 는 요청 하나가 통째로 걸려 있으면 그대로 타임아웃이 된다 — 끊기면 그 행은
  // pending 으로 남아 다음 수거가 같은 결과를 다시 읽는다(배치 결과는 생성 후 29일간
  // 보관되므로 며칠 뒤에 읽어도 그대로 있다).
  timeoutMs?: number;
  // 배치를 **내는** 호출(POST /v1/messages/batches)에만 쓰는 시간. 조회보다 한참 길다.
  //
  // 왜 따로 두는가 — 여기가 이 파일에서 유일하게 "끊으면 돈이 새는" 호출이다. POST 가
  // 서버에 닿은 뒤에 우리가 먼저 끊으면, 배치는 그대로 만들어져 **요금은 나가는데** 우리는
  // batch_id 를 모른다: 그 배치는 영영 수거되지 않고, 같은 진단이 잠시 뒤 다시 제출돼
  // 요금이 두 배가 된다. 조회는 끊겨도 다음 수거가 다시 물으면 그만이라 짧아도 되지만,
  // 제출은 본문이 크다(크론 경로는 사용자 25명 × 개념 10개 × 오답 표본 8건이 한 덩이로
  // 올라간다) — 20초는 업로드만으로도 빠듯하다. 상한을 Edge 함수 벽시계보다 낮게 둬서,
  // 끊더라도 런타임이 우리 대신 끊기 전에 우리가 사유를 남길 수 있게 한다.
  createTimeoutMs?: number;
  // 테스트가 가짜 응답을 꽂는 자리.
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_CREATE_TIMEOUT_MS = 90_000;

export function createAnthropicBatchTransport(
  opts: AnthropicTransportOptions,
): AnthropicBatchTransport {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const createTimeoutMs = opts.createTimeoutMs ?? DEFAULT_CREATE_TIMEOUT_MS;
  // 키는 이 클로저 밖으로 나가지 않는다. 오류 메시지·로그·응답에 절대 싣지 말 것.
  const headers = {
    "x-api-key": opts.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "content-type": "application/json",
  };

  async function callAbsolute(
    url: string,
    init: RequestInit = {},
    limitMs: number = timeoutMs,
  ): Promise<Response> {
    const res = await doFetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(limitMs),
    });
    if (!res.ok) {
      // 본문을 그대로 던지지 않는다 — 오류 본문에 요청 내용(오답 문항)이 되비칠 수 있고,
      // 이 문자열은 로그와 배치 행의 error 로 남는다. 키도 당연히 싣지 않는다.
      throw new AnthropicRequestError(
        `Anthropic ${init.method ?? "GET"} → ${res.status}`,
        res.status,
      );
    }
    return res;
  }

  function call(path: string, init: RequestInit = {}, limitMs?: number): Promise<Response> {
    return callAbsolute(`${ANTHROPIC_BASE}${path}`, init, limitMs);
  }

  return {
    async create(requests) {
      const res = await call(
        "",
        { method: "POST", body: JSON.stringify({ requests }) },
        createTimeoutMs,
      );
      const body = (await res.json()) as { id?: string };
      if (!body.id) throw new Error("Anthropic 배치 응답에 id 가 없다");
      return { id: body.id };
    },
    async cancel(batchId) {
      await call(`/${batchId}/cancel`, { method: "POST" });
    },
    async retrieve(batchId) {
      const res = await call(`/${batchId}`);
      const body = (await res.json()) as { processing_status?: string; results_url?: string | null };
      return {
        processingStatus: body.processing_status ?? "",
        // 응답이 준 주소만 받아들이고, 그것도 api.anthropic.com 인 것만 쓴다 — 응답 한 필드에
        // 따라 아무 주소나 부르러 가지 않는다(키가 헤더에 실려 나간다).
        resultsUrl:
          typeof body.results_url === "string" && body.results_url.startsWith("https://api.anthropic.com/")
            ? body.results_url
            : null,
      };
    },
    results(batchId, resultsUrl) {
      return {
        async *[Symbol.asyncIterator]() {
          // 배치 객체가 준 results_url 을 우선 쓴다(SDK 와 같은 경로). 없으면 문서화된
          // 엔드포인트로 직접 간다 — 둘 다 같은 파일을 준다.
          const res = resultsUrl
            ? await callAbsolute(resultsUrl)
            : await call(`/${batchId}/results`);
          const body = res.body;
          if (!body) return;
          const reader = body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          for (;;) {
            const { done, value } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            for (;;) {
              const nl = buffer.indexOf("\n");
              if (nl < 0) break;
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              const parsed = line ? safeParse(line) : null;
              if (parsed) yield parsed;
            }
            if (done) break;
          }
          // 마지막 줄에 개행이 없을 수 있다.
          const tail = buffer.trim() ? safeParse(buffer.trim()) : null;
          if (tail) yield tail;
        },
      };
    },
  };
}

// 한 줄이 깨졌다고 나머지 결과를 통째로 버리지 않는다 — 그 개념 하나만 "배치 결과에 없음"
// 으로 빠지고(mergeConceptResults 가 그렇게 센다) 나머지는 사용자에게 간다.
function safeParse(line: string): DiagnosisBatchResultLine | null {
  try {
    const v = JSON.parse(line) as DiagnosisBatchResultLine;
    return typeof v?.custom_id === "string" && v?.result ? v : null;
  } catch {
    return null;
  }
}

// ── 상수 ────────────────────────────────────────────────────────────────────

// 한 번에 배치로 밀어 넣을 진단 요청 수(크론 경로). 진단 하나가 개념 수(최대
// COACH_MAX_TOTAL)만큼의 요청으로 갈라지므로 배치 1건은 최대 그 곱(250건 남짓)이다 —
// 요청 10만 건·256MB 가 API 상한이므로 한참 아래다. 한 번에 처리하지 못한 요청은 다음
// 시간에 이어서 나간다. 앱·웹 버튼 경로는 userId 를 주므로 사실상 1이다.
const SUBMIT_BATCH_SIZE = 25;

// 같은 진단 요청에 대해 배치를 다시 낼 수 있는 횟수. 만들 게 없어 실패하는 요청
// (그 기간에 오답이 없다 등)을 크론이 매시간 영원히 재시도하면 요금과 로그만 쌓인다.
const MAX_ATTEMPTS_PER_DIAGNOSIS = 5;

// 제출 선점 유효 시간(초). 이 시간 동안은 같은 진단에 대해 아무도 다시 제출하지 않는다.
// 연타·재시도가 겹쳐 배치가 두 번 나가면 **그대로 요금이 두 배**다.
//
// 짧게 잡는 이유: 이건 "지금 누가 제출 중"이라는 표시이지 실패 쿨다운이 아니다. 제출
// 도중에 프로세스가 죽으면(배치는 나갔는데 기록 전) 2분 뒤 재제출이 되는데, 그 비용은
// 이미 감수한 쪽이다 — 아래 insert 주석 참고. 반대로 길게 잡으면 "만들 게 없다" 같은
// 사유가 사용자에게 안 보이는 시간만 늘어난다.
const SUBMIT_CLAIM_SECONDS = 120;

// 같은 배치를 다시 조회하기까지 서버가 강제하는 최소 간격(초). 앱이 화면에서 폴링하는
// 동안 그 폴링이 그대로 Anthropic 호출이 되면 안 된다 — 배치 상태 조회는 토큰 요금이
// 없지만 레이트리밋은 있고, 걸리면 그 순간 모든 사용자의 수거가 함께 막힌다.
//
// 이 값은 수거 **선점의 유효 시간**이기도 하다(같은 컬럼 하나로 둘 다 한다). 그런데 끝난
// 배치를 실제로 합치는 일(결과 JSONL 내려받기 + 개념별 파싱 + 저장)은 이 20초보다 오래
// 걸릴 수 있다 — 그러면 내려받는 도중에 다른 호출자가 같은 행을 잡아 두 번 합친다. 그래서
// **`ended` 를 본 순간 그 행의 임차를 아래 값만큼 연장하고 나서** 내려받는다(extendCollectLease).
// 간격을 통째로 늘려 해결하지 않는 이유는, 아직 안 끝난 배치를 다시 묻는 주기까지 같이
// 느려져 결과가 그만큼 늦게 뜨기 때문이다.
export const DIAGNOSIS_RECHECK_SECONDS = 20;

// 끝난 배치를 합치는 동안 그 행을 붙잡아 두는 시간(초). 조회 타임아웃(transport 기본 20초)
// 두 번 + 저장이 넉넉히 들어가야 한다. 지나면 저절로 풀려 다음 수거가 다시 집는다 —
// 합치다 죽은 호출이 결과를 영원히 묶어 두면 안 된다.
const COLLECT_WORK_SECONDS = 90;

// Message Batches 의 약속 — 대부분 1시간 안, **최대 24시간**. 배치를 찾을 수 없다는 답을
// 받아도 이 시간 전에는 배치를 버리지 않는다(위 retrieve catch 참고): 수거하는 키가 웹·Edge
// 둘이라, 한쪽 키가 다른 워크스페이스면 멀쩡한 배치가 404 로 보인다.
const BATCH_SLA_HOURS = 24;

// ── 제출 ────────────────────────────────────────────────────────────────────

type BatchItemContext = {
  // 제출 시점에 계산해 둔 리포트의 무AI 부분. 수거할 때 코칭만 얹어 저장한다.
  report: Omit<AiDiagnosisReport, "conceptCoaching">;
  // 그때 물어본 개념들. 모델 응답을 화면 데이터에 다시 붙이는 열쇠다. conceptId 는
  // 수거된 극복법 카드가 "같은 개념 기출 풀기"를 정본 개념 축으로 열어주기 위한 값이라
  // 여기에 함께 저장해 둔다(구버전 행에는 없어서 화면이 표기로 떨어진다).
  targets: {
    concept: string;
    conceptId?: string | null;
    subject: string | null;
    subjectSlug: string | null;
  }[];
};

type PendingDiagnosisRow = {
  id: string;
  user_id: string;
  // 요청할 때 사용자가 고른 개념들. null 이면 생성기가 알아서 상위 개념을 고른다
  // (구버전 요청·배치 스크립트로 만들어진 행).
  selected_concepts: DiagnosisConceptSelection[] | null;
};

export type DiagnosisBatchDeps = {
  // 없으면 제출·수거를 **하지 않는다**(키 미설정). 오류가 아니라 "아직 설정되지 않음"으로
  // 다루는 것이 중요하다 — 여기서 실패로 터뜨리면 소유자가 Edge secret 을 넣기 전까지
  // 진단 요청 자체가 죽는다. 요청 행은 그대로 남아 시간당 크론이 예전처럼 주워 간다.
  transport: AnthropicBatchTransport | null;
  // 실제로 부를 모델. 요금에 닿는 값이라 기본은 core 상수 하나뿐이다.
  model?: string;
  now?: Date;
};

export type SubmitResult = {
  // 배치에 실제로 실린 진단 요청 수.
  submitted: number;
  // 만들 게 없어 건너뛴 요청 수(그 기간에 오답이 없다 등).
  skipped: number;
  batchId?: string;
  // 사용자에게 그대로 보여줄 수 있는 사유(요청 하나짜리 제출에서만 의미가 있다).
  error?: string;
};

// report 가 비어 있는 진단 요청을 모아 배치 1건으로 제출한다.
//
// userId 를 주면 그 사람 것만 낸다("진단 받기"를 누른 즉시 부르는 경로 — 웹 서버 액션과
// Edge `diagnosis-request`). 주지 않으면 대기 중인 요청 전체를 훑는다(크론).
export async function submitPendingDiagnoses(
  admin: SupabaseClient,
  opts: { userId?: string; limit?: number } = {},
  deps: DiagnosisBatchDeps,
): Promise<SubmitResult> {
  const transport = deps.transport;
  if (!transport) {
    return { submitted: 0, skipped: 0, error: "진단 생성이 아직 설정되지 않았어요." };
  }

  const now = deps.now ?? new Date();
  const model = deps.model ?? DIAGNOSIS_MODEL_DEFAULT;
  const limit = opts.limit ?? SUBMIT_BATCH_SIZE;

  // 대기 중인 요청. 주기(7일) 밖으로 밀려난 오래된 요청까지 되살리지는 않는다 —
  // 그 사이 사용자의 오답은 이미 다음 주기의 분석 창으로 넘어갔다.
  const since = new Date(now);
  since.setDate(since.getDate() - (DIAGNOSIS_CYCLE_DAYS - 1));
  let query = admin
    .from("ai_diagnoses")
    .select("id, user_id, selected_concepts")
    .is("report", null)
    .gte("diagnosis_date", since.toISOString().slice(0, 10))
    .order("requested_at", { ascending: true })
    .limit(limit);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data: pendingRows } = await query;
  const pending = (pendingRows ?? []) as PendingDiagnosisRow[];
  if (pending.length === 0) return { submitted: 0, skipped: 0 };

  // 이미 배치에 실려 처리 중인 요청은 다시 내지 않는다(같은 진단에 두 번 요금이 나간다).
  // 시도 횟수 상한도 여기서 본다 — 만들 게 없어 계속 실패하는 요청을 크론이 영원히
  // 재시도하지 않도록.
  const { data: existing } = await admin
    .from("ai_diagnosis_batches")
    .select("diagnosis_id, status")
    .in("diagnosis_id", pending.map((p) => p.id));
  const attempts = new Map<string, number>();
  const inFlight = new Set<string>();
  for (const row of (existing ?? []) as { diagnosis_id: string; status: string }[]) {
    attempts.set(row.diagnosis_id, (attempts.get(row.diagnosis_id) ?? 0) + 1);
    if (row.status === "pending") inFlight.add(row.diagnosis_id);
  }

  let skipped = 0;
  const candidates: PendingDiagnosisRow[] = [];
  for (const row of pending) {
    if (inFlight.has(row.id)) continue;
    if ((attempts.get(row.id) ?? 0) >= MAX_ATTEMPTS_PER_DIAGNOSIS) {
      skipped++;
      continue;
    }
    candidates.push(row);
  }
  if (candidates.length === 0) return { submitted: 0, skipped };

  // 위 in-flight 검사는 **읽은 뒤에 쓰는** 판정이라, 연타나 재시도가 겹치면 둘 다 통과해
  // 배치가 두 번 나간다(요금 두 배). 그래서 실제로 제출할 요청은 여기서 한 문장으로
  // 선점한다 — 잡힌 것만 아래로 내려간다(§6.6 "복습 세션 선점"과 같은 수법).
  const claim = await claimForSubmit(admin, candidates.map((c) => c.id), now);
  if (claim.error) {
    // 선점 자체가 실패했다(대표적으로 `batch_claimed_at` 컬럼이 아직 없는 운영 DB).
    // 조용히 0건을 돌려주면 진단이 영원히 안 만들어지는데 화면은 아무 말도 하지 않는다 —
    // 선점 없이 제출하는 쪽으로 물러서지도 않는다(그게 요금 두 배를 막는 장치다).
    return { submitted: 0, skipped, error: "진단 생성을 시작하지 못했어요. 잠시 후 다시 시도해주세요." };
  }
  const rows = candidates.filter((c) => claim.ids.has(c.id));
  if (rows.length === 0) {
    // 후보는 있었는데 하나도 못 잡았다 = 같은 진단을 지금 다른 호출이 제출하는 중이거나,
    // 방금 전 제출이 아직 SUBMIT_CLAIM_SECONDS 안이다. 크론에는 흔한 일이라 조용히 넘기지만,
    // **사람이 버튼을 눌러 온 요청**(userId)에는 사유를 돌려준다 — 여기서 침묵하면 화면이
    // "요청했어요"라고 말한 뒤 아무 일도 일어나지 않는다(고른 개념에 오답이 없어 실패한
    // 직후 다시 누르는 경우가 그렇다: 사유가 사라진 채 선택창만 닫힌다).
    return {
      submitted: 0,
      skipped,
      error: opts.userId ? "조금 전 요청을 처리하는 중이에요. 잠시 후 다시 시도해주세요." : undefined,
    };
  }

  const requests: DiagnosisBatchRequest[] = [];
  const items: {
    diagnosis_id: string;
    user_id: string;
    custom_id: string;
    context: BatchItemContext;
  }[] = [];
  let lastError: string | undefined;

  for (const row of rows) {
    const { plan, error } = await planCoaching(
      admin,
      row.user_id,
      // 개념을 직접 고른 요청이면 과목 제외 설정은 볼 필요가 없다(선택이 이미 과목까지
      // 정한다). 고르지 않은 구버전 요청만 예전처럼 과목 제외로 좁힌다.
      row.selected_concepts?.length
        ? new Set<string>()
        : await getExcludedDiagnosisSubjectSlugs(admin, row.user_id),
      row.selected_concepts ?? null,
      { model },
    );
    if (!plan) {
      skipped++;
      lastError = error;
      continue;
    }

    // custom_id 는 배치 안에서만 유일하면 된다. 진단 행 id 를 접두로 쓰고 개념 순번을
    // 붙이면(diagnosis-batch-merge.ts) 결과를 되돌릴 때 매칭 표가 따로 필요 없다 —
    // 접두로 진단 행을, 순번으로 그 진단의 몇 번째 개념인지를 찾는다.
    for (const r of plan.requests) {
      requests.push({ custom_id: batchCustomId(row.id, r.index), params: r.params });
    }
    items.push({
      diagnosis_id: row.id,
      user_id: row.user_id,
      custom_id: row.id,
      context: {
        report: plan.report,
        targets: plan.targets.map((t) => ({
          concept: t.concept,
          conceptId: t.conceptId,
          subject: t.subject,
          subjectSlug: t.subjectSlug,
        })),
      },
    });
  }

  if (items.length === 0) return { submitted: 0, skipped, error: lastError };

  let batchId: string;
  try {
    batchId = (await transport.create(requests)).id;
  } catch {
    return {
      submitted: 0,
      skipped,
      error: "진단 생성을 시작하지 못했어요. 잠시 후 다시 시도해주세요.",
    };
  }

  // 배치를 낸 뒤에 기록한다. 반대 순서로 하면 create 가 실패했을 때 존재하지 않는
  // 배치를 영원히 기다리는 행이 남는다. 여기서 insert 가 실패하면 그 배치는 batch_id 를
  // 아무도 모르는 채로 남아 수거되지 못하는데, 진단은 pending 이라 다음 제출이 같은 것을
  // 다시 만든다 — **그대로 두면 요금이 두 배다.** 그래서 기록에 실패한 배치는 그 자리에서
  // 취소한다(아직 처리하지 않은 요청은 취소로 요금이 멎는다). 취소마저 실패하면 그때는
  // 정말 버리는 수밖에 없다 — 조용히 결과가 사라지는 쪽보다는 낫고, 다음 제출을 막으면
  // 사용자가 이번 주기에 아무것도 못 받는다.
  const { error: insertError } = await admin.from("ai_diagnosis_batches").insert(
    items.map((it) => ({
      diagnosis_id: it.diagnosis_id,
      user_id: it.user_id,
      batch_id: batchId,
      custom_id: it.custom_id,
      model,
      context: it.context,
      status: "pending",
    })),
  );
  if (insertError) {
    await transport.cancel?.(batchId).catch(() => {});
    return { submitted: 0, skipped, batchId, error: "진단 요청 기록에 실패했어요." };
  }

  // submitted 는 진단(사용자) 수다. 요청 수(개념 수의 합)가 아니다.
  return { submitted: items.length, skipped, batchId, error: lastError };
}

// 제출 선점. `batch_claimed_at` 은 "지금 누가 이 진단을 제출하는 중"이라는 표시이고,
// SUBMIT_CLAIM_SECONDS 가 지나면 저절로 풀린다(제출 도중 죽은 프로세스가 진단을 영원히
// 묶어 두지 않게). update … returning 한 문장이라 동시에 들어온 둘 중 하나만 잡는다.
async function claimForSubmit(
  admin: SupabaseClient,
  ids: string[],
  now: Date,
): Promise<{ ids: Set<string>; error?: string }> {
  if (ids.length === 0) return { ids: new Set() };
  const cutoff = new Date(now.getTime() - SUBMIT_CLAIM_SECONDS * 1000).toISOString();
  const { data, error } = await admin
    .from("ai_diagnoses")
    .update({ batch_claimed_at: now.toISOString() })
    .in("id", ids)
    // report 가 그 사이에 채워졌으면 제출할 이유가 없다.
    .is("report", null)
    .lt("batch_claimed_at", cutoff)
    .select("id");
  if (error) return { ids: new Set(), error: error.message };
  return { ids: new Set(((data ?? []) as { id: string }[]).map((r) => r.id)) };
}

// ── 수거 ────────────────────────────────────────────────────────────────────

export type CollectResult = {
  // report 를 채운 진단 수.
  ready: number;
  // 모델이 만들지 못했거나(빈 응답) 배치가 만료·오류로 끝난 수.
  failed: number;
  // 아직 처리 중이거나(배치 미완료) 재확인 간격 전이라 그대로 둔 수.
  pending: number;
};

type PendingBatchItem = {
  id: string;
  diagnosis_id: string;
  user_id: string;
  batch_id: string;
  custom_id: string;
  // 제출 시각. "이 배치를 버려도 되는가"(BATCH_SLA_HOURS)를 재는 축이라 함께 읽는다.
  requested_at: string;
  context: BatchItemContext;
};

// 끝난 배치의 결과를 읽어 report 를 채운다.
//
// userId 를 주면 그 사람의 진행 중 배치만 확인한다(진단 화면이 기다리는 동안 부르는
// 경로 — 웹 페이지 진입·Edge `diagnosis-collect`). 주지 않으면 진행 중인 배치 전체를
// 본다(크론).
//
// **남의 결과는 절대 건드리지 않는다.** 한 배치에 여러 사용자가 실릴 수 있으므로(크론
// 경로가 그렇다) 결과 JSONL 을 훑을 때 **선점한 내 행의 custom_id 접두에 해당하는 줄만**
// 고른다. 모르는 접두는 그냥 버린다 — 응답에도, 다른 사람의 진단에도 들어가지 않는다.
export async function collectDiagnosisBatches(
  admin: SupabaseClient,
  opts: { userId?: string; limit?: number } = {},
  deps: DiagnosisBatchDeps,
): Promise<CollectResult> {
  const transport = deps.transport;
  if (!transport) return { ready: 0, failed: 0, pending: 0 };
  const now = deps.now ?? new Date();
  const model = deps.model ?? DIAGNOSIS_MODEL_DEFAULT;

  let query = admin
    .from("ai_diagnosis_batches")
    .select("id")
    .eq("status", "pending")
    .order("requested_at", { ascending: true })
    .limit(opts.limit ?? 200);
  if (opts.userId) query = query.eq("user_id", opts.userId);
  const { data } = await query;
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return { ready: 0, failed: 0, pending: 0 };

  // 선점. 잡지 못한 행은 (a) 방금 다른 호출자가 확인했거나 (b) 지금 누가 수거 중이다 —
  // 둘 다 "아직 pending" 으로 돌려주면 된다. 여기서 재확인 간격도 함께 강제된다.
  const items = await claimForCollect(admin, ids, now);
  const out: CollectResult = { ready: 0, failed: 0, pending: ids.length - items.length };
  if (items.length === 0) return out;

  // 한 배치에 여러 사용자가 실려 있으므로 배치 단위로 묶어 한 번씩만 조회한다.
  const byBatch = new Map<string, PendingBatchItem[]>();
  for (const it of items) {
    const list = byBatch.get(it.batch_id) ?? [];
    list.push(it);
    byBatch.set(it.batch_id, list);
  }

  for (const [batchId, group] of byBatch) {
    let batch: { processingStatus: string; resultsUrl: string | null };
    try {
      batch = await transport.retrieve(batchId);
    } catch (e) {
      if (!isPermanentBatchError(e)) {
        // 지금 잠깐 안 되는 것(429·5xx·타임아웃·네트워크). **닫지 않는다** — 닫으면 이미
        // 요금을 낸 배치를 버리고 다음 제출이 같은 진단을 새로 만든다(요금 두 배).
        // 그대로 두면 다음 수거가 같은 배치를 다시 묻는다.
        out.pending += group.length;
        continue;
      }
      // 배치를 찾을 수 없다(404) 또는 키가 거부됐다(401·403). **이 키로는** 몇 번을 더
      // 물어도 답이 같다. 그래도 곧바로 닫지는 않는다 — 수거하는 키가 둘이기 때문이다:
      // 웹 크론은 Vercel 의 `ANTHROPIC_DIAGNOSIS_API_KEY`, Edge 는 Supabase secret 의
      // `ANTHROPIC_API_KEY` 다. 둘이 다른 워크스페이스로 설정되면(설정 실수 하나로 그렇게
      // 된다 — SETUP.md 가 "같은 워크스페이스"라고 경고하는 이유) 한쪽이 낸 배치가 다른
      // 쪽에는 404 로 보인다. 그때 바로 닫으면 **이미 요금을 낸, 지금도 잘 돌고 있는
      // 배치를 버리고** 같은 진단을 새로 제출한다(요금 두 배, 그것도 매 수거마다).
      //
      // 그래서 배치 SLA(최대 24시간)가 지나기 전에는 닫지 않고 pending 으로 둔다. 키가
      // 맞는 쪽 수거가 그 사이에 결과를 가져가면 그것으로 끝이고, 정말 없는 배치라면
      // 24시간 뒤에 닫혀 다음 제출이 다시 만든다(그 고리의 상한은 제출 쪽의
      // MAX_ATTEMPTS_PER_DIAGNOSIS). 빨리 실패하는 것보다 요금을 아끼는 쪽을 고른다.
      const stale = group.filter(
        (g) => now.getTime() - Date.parse(g.requested_at) >= BATCH_SLA_HOURS * 3_600_000,
      );
      if (stale.length === 0) {
        out.pending += group.length;
        continue;
      }
      await closeItems(admin, stale.map((g) => g.id), "failed", "배치를 찾을 수 없어요.", now);
      out.failed += stale.length;
      out.pending += group.length - stale.length;
      continue;
    }

    // 끝나지 않았으면 **결과를 내려받지 않는다** — 내려받기는 비싸고 느리다.
    if (batch.processingStatus !== "ended") {
      out.pending += group.length;
      continue;
    }

    // 여기서부터는 길다(JSONL 내려받기 + 파싱 + 저장). 선점은 DIAGNOSIS_RECHECK_SECONDS
    // 짜리라 그 사이에 다른 호출자가 같은 행을 다시 집을 수 있으므로, 내려받기 **전에**
    // 임차를 연장한다. 두 번 합쳐도 리포트가 깨지지는 않지만(saveDiagnosisReport 의
    // `report is null`), 같은 파일을 두 번 내려받는 것은 그대로 낭비이고 레이트리밋이다.
    await extendCollectLease(admin, group.map((g) => g.id), now);

    // 결과의 custom_id 는 `<진단 행 id>_<개념 순번>` 이다(구형 배치는 진단 행 id 그대로).
    // 접두로 진단 행을 찾고, 그 진단의 개념별 결과를 모아 뒀다가 결과 파일을 다 읽은 뒤
    // 진단 단위로 합쳐 저장한다 — 한 진단의 요청들은 같은 배치에 있으므로 이 한 바퀴에
    // 전부 들어 있다.
    const byPrefix = new Map(group.map((g) => [g.custom_id, g]));
    const gathered = new Map<string, ConceptResult[]>();
    try {
      for await (const line of transport.results(batchId, batch.resultsUrl)) {
        const { prefix, index } = parseBatchCustomId(line.custom_id);
        const item = byPrefix.get(prefix);
        // 내 것이 아니면 버린다(남의 진단·남의 사용자). 이 한 줄이 "한 배치에 여러
        // 사용자" 를 안전하게 만든다.
        if (!item) continue;
        const list = gathered.get(item.id) ?? [];
        gathered.set(item.id, list);
        if (line.result.type !== "succeeded") {
          // errored / canceled / expired. 사유는 합칠 때 개념 이름과 함께 error 에 남는다.
          list.push({ index, status: line.result.type, text: "" });
          continue;
        }
        list.push({
          index,
          status: "succeeded",
          text: (line.result.message?.content ?? [])
            .map((b) => (b.type === "text" ? (b.text ?? "") : ""))
            .join(""),
        });
      }
    } catch {
      // 내려받다가 끊겼다(타임아웃·네트워크). 그대로 pending 으로 둔다 — 배치 결과는
      // 생성 후 29일간 보관되므로 다음 수거가 같은 결과를 다시 읽는다(이미 낸 요금을
      // 버리지 않는다). 위에서 연장해 둔 임차는 그 사이에 저절로 풀린다.
      out.pending += group.length;
      continue;
    }

    for (const item of group) {
      const conceptResults = gathered.get(item.id);
      if (!conceptResults) {
        // 결과 파일에 아예 없던 진단(있어서는 안 되지만, 있으면 영원히 pending 이 된다).
        await closeItems(admin, [item.id], "failed", "배치 결과에 이 요청이 없어요.", now);
        out.failed++;
        continue;
      }

      const { coaching, failures } = mergeConceptResults(conceptResults, item.context.targets);
      if (coaching.length === 0) {
        // 개념이 하나도 안 나왔을 때만 실패다. 이유를 남겨 두면 나중에 "왜 안 나왔지"를
        // 로그를 뒤지지 않고 이 테이블에서 볼 수 있다.
        await closeItems(
          admin,
          [item.id],
          "failed",
          failures.join(" / ") || "모델이 극복법을 만들지 못했어요.",
          now,
        );
        out.failed++;
        continue;
      }

      const saved = await saveDiagnosisReport(
        admin,
        item.diagnosis_id,
        item.context.report,
        coaching,
        model,
        now,
      );
      if (saved.error) {
        // 저장만 실패한 경우다. 결과 자체는 이미 배치에서 사라지지 않으므로 pending 으로
        // 두고 다음 수거에서 같은 결과를 다시 읽는다.
        out.pending++;
        continue;
      }
      // 일부 개념이 빠진 채 저장됐으면 그 사실을 ready 행의 error 에 남긴다 — 사용자가
      // "고른 건 8개인데 6개만 왔다"고 물었을 때 여기서 바로 답이 나온다.
      await closeItems(
        admin,
        [item.id],
        "ready",
        failures.length > 0 ? failures.join(" / ") : null,
        now,
      );
      out.ready++;
    }
  }

  return out;
}

// 수거 선점 + 재확인 간격. 한 문장이라 동시에 들어온 둘 중 하나만 행을 가져간다 — 두 번
// 합치면 리포트가 덮이거나 반쪽이 된다(그 마지막 방어선이 saveDiagnosisReport 의
// `report is null` 조건이다).
//
// 잡는 순간 `last_checked_at` 이 지금으로 밀리므로, 앱이 1초마다 폴링해도 Anthropic 을
// 두드리는 것은 DIAGNOSIS_RECHECK_SECONDS 에 한 번뿐이다.
async function claimForCollect(
  admin: SupabaseClient,
  ids: string[],
  now: Date,
): Promise<PendingBatchItem[]> {
  const cutoff = new Date(now.getTime() - DIAGNOSIS_RECHECK_SECONDS * 1000).toISOString();
  const { data } = await admin
    .from("ai_diagnosis_batches")
    .update({ last_checked_at: now.toISOString() })
    .in("id", ids)
    .eq("status", "pending")
    .lt("last_checked_at", cutoff)
    .select("id, diagnosis_id, user_id, batch_id, custom_id, requested_at, context");
  return (data ?? []) as PendingBatchItem[];
}

// 합치는 동안 선점을 붙잡아 둔다. `last_checked_at` 을 미래로 밀어 두는 것이 곧 임차
// 연장이다 — 같은 `lt(cutoff)` 조건 하나로 재확인 간격과 선점을 함께 보므로, 다른 컬럼을
// 만들지 않고 이 한 줄로 끝난다. 실패해도 진행한다(선점이 짧아질 뿐이고, 두 번 합치는
// 경우의 방어선은 그대로 saveDiagnosisReport 의 `report is null` 이다).
async function extendCollectLease(admin: SupabaseClient, ids: string[], now: Date) {
  if (ids.length === 0) return;
  const until = new Date(now.getTime() + COLLECT_WORK_SECONDS * 1000).toISOString();
  await admin.from("ai_diagnosis_batches").update({ last_checked_at: until }).in("id", ids);
}

async function closeItems(
  admin: SupabaseClient,
  ids: string[],
  status: "ready" | "failed",
  error: string | null,
  now: Date,
) {
  if (ids.length === 0) return;
  await admin
    .from("ai_diagnosis_batches")
    .update({ status, error, completed_at: now.toISOString() })
    .in("id", ids);
}

// ── 한 사람의 수거(앱·웹 화면이 기다리는 동안 부르는 것) ────────────────────

export type DiagnosisCollectStatus = "pending" | "ready" | "failed" | "none";

export type DiagnosisCollectOutcome = {
  // none    — 이번 주기에 요청 자체가 없다(화면은 요청 버튼을 그린다)
  // pending — 아직 만들어지는 중(배치가 안 끝났거나, 제출 대기 중이거나, 재확인 간격 전)
  // ready   — 리포트가 채워졌다. 앱은 `ai_diagnoses` 를 다시 읽어 본문을 그린다
  // failed  — 이 주기 배치가 실패로 닫혔다(사유는 error). 다시 요청할 수 있다
  status: DiagnosisCollectStatus;
  // 이번 주기 요청 행의 KST 날짜(YYYY-MM-DD). 앱이 폴링·조회 대상 행을 고르는 축.
  date: string | null;
  // 배치가 제출된 시각(있으면). 화면이 "N분째 만드는 중"을 말한다.
  requestedAt: string | null;
  // 이 배치가 물어본 개념 수. 0 이면 아직 제출 전이다.
  conceptCount: number;
  // 실패 사유(사용자에게 그대로 보여줄 수 있는 문구). 그 외에는 null.
  error: string | null;
};

// 이 사용자의 진행 중 배치만 확인하고, 끝났으면 그 자리에서 수거해 리포트를 저장한다.
//
// 부르는 곳은 Edge `diagnosis-collect` 하나다 — 앱은 수거 결과를 `{status}` 하나로 받아야
// 폴링을 멈출 수 있기 때문이다(none/pending/ready/failed). 웹 진단 페이지는 서버 렌더에서
// 같은 일을 `collectDiagnosisBatches({userId})` + `getPendingDiagnosisBatch` 두 조각으로
// 하고 그 값을 그대로 화면에 쓴다(page.tsx) — **수거 본문은 아래 collectDiagnosisBatches
// 하나뿐이고**, 이 함수는 그 위에 "이번 주기 요청 행"을 얹어 상태 하나로 접는 껍데기다.
export async function collectDiagnosisForUser(
  admin: SupabaseClient,
  userId: string,
  deps: DiagnosisBatchDeps,
): Promise<DiagnosisCollectOutcome> {
  const now = deps.now ?? new Date();
  const empty = { date: null, requestedAt: null, conceptCount: 0, error: null };

  // 이번 주기 요청 행부터 본다. 지난 주기의 배치 행을 보면 "이미 끝난 옛 진단"을 계속
  // ready 라고 말하게 된다.
  const weekly = await getWeeklyDiagnosis(admin, userId, now);
  if (!weekly) return { status: "none", ...empty };
  // 리포트가 이미 있으면 수거할 것이 없다(Anthropic 을 부르지 않는다).
  if (weekly.status === "ready") {
    return { status: "ready", ...empty, date: weekly.date };
  }

  let batch = await latestBatchFor(admin, weekly.id);
  // 요청 행은 있는데 배치 행이 없다 = 아직 제출되지 않았다(키 미설정·제출 실패).
  // 실패가 아니라 대기다 — 시간당 크론이 예전처럼 주워 간다.
  if (!batch) return { status: "pending", ...empty, date: weekly.date };

  if (batch.status === "pending") {
    await collectDiagnosisBatches(admin, { userId }, deps);
    // 수거 뒤 상태를 다시 읽는다. 내가 잡지 못했으면(다른 호출자가 수거 중) 그대로 pending.
    batch = (await latestBatchFor(admin, weekly.id)) ?? batch;
  }

  const shared = {
    date: weekly.date,
    requestedAt: batch.requestedAt,
    conceptCount: batch.conceptCount,
  };
  if (batch.status === "ready") return { status: "ready", ...shared, error: null };
  if (batch.status === "failed") return { status: "failed", ...shared, error: batch.error };
  return { status: "pending", ...shared, error: null };
}

type LatestBatch = {
  status: string;
  error: string | null;
  requestedAt: string;
  conceptCount: number;
};

async function latestBatchFor(
  admin: SupabaseClient,
  diagnosisId: string,
): Promise<LatestBatch | null> {
  const { data } = await admin
    .from("ai_diagnosis_batches")
    .select("status, error, requested_at, context")
    .eq("diagnosis_id", diagnosisId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as {
    status: string;
    error: string | null;
    requested_at: string;
    context: { targets?: unknown[] } | null;
  };
  return {
    status: row.status,
    error: row.error,
    requestedAt: row.requested_at,
    conceptCount: Array.isArray(row.context?.targets) ? row.context.targets.length : 0,
  };
}
