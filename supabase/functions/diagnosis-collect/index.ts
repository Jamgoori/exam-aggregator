// AI 약점 진단 **수거**(설계서 §6.7 #21). `diagnosis-request` 가 낸 배치가 끝났는지 보고,
// 끝났으면 그 자리에서 결과를 합쳐 `ai_diagnoses.report` 를 채운다.
//
//   {} → { status: "none" | "pending" | "ready" | "failed",
//          date, requestedAt, conceptCount, error, recheckSeconds }
//
// 왜 이 함수가 있나: 예전에는 수거도 웹 Vercel 크론(시간당 1회)만 했다. 배치가 5분 만에
// 끝나도 사용자는 다음 정시까지 아무것도 못 봤다. 앱은 화면을 열어 둔 채 기다리는
// 동안 이 함수를 부른다 — 다음 정시를 기다리지 않는다. 크론은 그대로 **안전망**으로 둔다
// (앱을 닫은 사용자와 웹 요청이 그걸로 산다).
//
// 규칙 본문은 core `rules/diagnosis-batch.ts#collectDiagnosisForUser` 한 벌이고 웹 진단
// 화면도 같은 함수를 부른다. 여기는 인증과 응답 직렬화만 한다.
//
// 이 함수가 지키는 것 세 가지:
//   1) **내 것만.** `ai_diagnosis_batches` 에서 `user_id = 호출자` 인 행만 선점하고, 결과
//      JSONL 에서도 내 custom_id 접두에 해당하는 줄만 고른다. 한 배치에 여러 사용자가
//      실릴 수 있다(크론 경로가 그렇다) — 남의 결과는 응답에도, 남의 진단에도 안 들어간다.
//   2) **끝나기 전에는 내려받지 않는다.** `processing_status !== "ended"` 면 결과 파일을
//      건드리지 않고 즉시 pending 을 돌려준다(내려받기는 비싸고 느리다).
//   3) **두 번 합치지 않는다.** 크론과 앱이 동시에 수거할 수 있으므로 행을 한 문장으로
//      선점하고(`last_checked_at`), 못 잡으면 조용히 pending 을 돌려준다.
//
// 재확인 간격도 서버가 정한다(core DIAGNOSIS_RECHECK_SECONDS). 앱이 1초마다 불러도
// 그보다 이르면 Anthropic 을 부르지 않고 pending 만 돌려준다 — 배치 상태 조회는 토큰
// 요금이 없지만 레이트리밋은 있고, 걸리면 모든 사용자의 수거가 함께 막힌다.
//
// 오류(§6.9): 401 로그인 필요. 그 외에는 200 이고 status 로 말한다 — 수거 실패는 사용자가
// 할 수 있는 일이 없는 상태(아직 안 끝남)와 구분이 안 되므로 5xx 로 올리면 화면이 "오류"를
// 그리다 결국 결과가 나온다.
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, diagnosisBatchDeps, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import { DIAGNOSIS_RECHECK_SECONDS, collectDiagnosisForUser } from "../_shared/core.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const admin = coreAdmin();

  // 결과 JSONL 내려받기가 끼어 있어 응답이 길어질 수 있다. core 의 transport 가 HTTP
  // 호출마다 타임아웃을 걸어 두므로(AbortSignal), 끊기면 그 행은 pending 으로 남고 다음
  // 호출이 같은 결과를 다시 읽는다(배치 결과는 생성 후 29일간 보관된다 — 이미 낸 요금을
  // 버리지 않는다).
  let outcome;
  try {
    outcome = await collectDiagnosisForUser(admin, auth.userId, diagnosisBatchDeps());
  } catch (e) {
    // 수거가 통째로 실패해도 사용자의 진단은 잃지 않는다 — 배치는 그대로 pending 이고
    // 크론이 다시 줍는다. 화면에는 "아직 만드는 중"으로 보인다.
    console.error("diagnosis-collect 실패", e instanceof Error ? e.message : String(e));
    outcome = {
      status: "pending" as const,
      date: null,
      requestedAt: null,
      conceptCount: 0,
      error: null,
    };
  }

  return json({
    status: outcome.status,
    date: outcome.date,
    requestedAt: outcome.requestedAt,
    conceptCount: outcome.conceptCount,
    error: outcome.error,
    // 다음 호출까지 기다릴 최소 간격(초). 서버가 강제하는 값과 같다.
    recheckSeconds: DIAGNOSIS_RECHECK_SECONDS,
  });
});
