// CBT 채점. 규칙 본문은 packages/core/src/rules/cbt-attempt.ts#submitCbtAttempt
// (웹 papers/actions.ts#submitCbtAttempt 와 같은 함수) — 정답 조회·시작 행 원자 회수·
// 최소 응시시간·채점·응시 기록·문항 상태·출석·진단 진행률까지 전부 거기서 한다.
// 여기는 요청 파싱과 service_role 클라이언트 주입만 한다.
//
// 시작 행은 채점 **전에** 회수된다(설계서 §6.6) — 웹+앱 동시 제출이나 앱 타임아웃
// 재시도가 겹쳐도 한쪽만 채점된다. 나머지는 "새로고침 후 다시 시작해주세요." 를 받는데,
// 앱은 이 오류를 "이미 채점됨"으로 해석해 recoverAttempt() 로 결과를 복원한다.
//
// 응답에 diagnosisProgress{attemptCount, wrongCount} 가 추가됐다(§6.7 #2, 추가 필드).
import { corsHeaders, isUuid, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import { isCbtRuleError, submitCbtAttempt } from "../_shared/core.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  let paperId = "";
  let submitted: unknown[] = [];
  try {
    const body = await req.json();
    paperId = String(body?.paperId ?? "");
    submitted = Array.isArray(body?.answers) ? body.answers : [];
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (!isUuid(paperId)) return json({ error: "잘못된 접근입니다." }, 400);

  const result = await submitCbtAttempt(coreAdmin(), auth.userId, paperId, submitted);
  if (isCbtRuleError(result)) return json({ error: result.error }, result.status);

  return json({
    success: true,
    attemptId: result.attemptId,
    score: result.score,
    totalQuestions: result.totalQuestions,
    durationSeconds: result.durationSeconds,
    voidedQuestions: result.voidedQuestions,
    questionResults: result.questionResults,
    diagnosisProgress: result.diagnosisProgress ?? null,
  });
});
