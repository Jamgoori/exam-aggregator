// CBT 시작 기록. 규칙 본문은 packages/core/src/rules/cbt-attempt.ts#startCbtAttempt
// (웹 papers/actions.ts#startCbtAttempt 와 같은 함수) — 시작 시각을 service_role 로만
// 기록하고 그 시각을 그대로 응답에 실어 돌려준다. 클라이언트가 자기 시계로 먼저
// 타이머를 시작하면 네트워크 지연만큼 서버 기준 최소 응시시간(MIN_ATTEMPT_SECONDS)이
// 화면보다 늦게 끝나므로, 반드시 이 응답의 startedAt 을 기준시각으로 써야 한다.
import { corsHeaders, isUuid, json } from "../_shared/http.ts";
import { coreAdmin, requireUser, testOverrides } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import { isCbtRuleError, startCbtAttempt } from "../_shared/core.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  let paperId = "";
  try {
    paperId = String((await req.json())?.paperId ?? "");
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (!isUuid(paperId)) return json({ error: "잘못된 접근입니다." }, 400);

  // now 는 계약 테스트 전용 주입(GONGMOA_TEST_HOOKS=1 일 때만 헤더를 읽는다). 평소엔 undefined
  // 라 규칙의 기본값(new Date())으로 돈다.
  const result = await startCbtAttempt(coreAdmin(), auth.userId, paperId, testOverrides(req).now);
  if (isCbtRuleError(result)) return json({ error: result.error }, result.status);

  return json({ success: true, startedAt: result.startedAt });
});
