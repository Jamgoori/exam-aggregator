// 웹 startCbtAttempt 포팅. 시작 시각을 service_role 로만 기록하고 그 시각을
// 그대로 응답에 실어 돌려준다 — 클라이언트가 자기 시계로 먼저 타이머를 시작하면
// 네트워크 지연만큼 서버 기준 최소 응시시간(MIN_ATTEMPT_SECONDS)이 화면보다
// 늦게 끝나므로, 반드시 이 응답의 startedAt 을 기준시각으로 써야 한다.
import { corsHeaders, isUuid, json } from "../_shared/cbt.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";

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

  const startedAt = new Date().toISOString();
  const { error } = await adminClient()
    .from("cbt_attempt_starts")
    .upsert(
      { user_id: auth.userId, paper_id: paperId, started_at: startedAt },
      { onConflict: "user_id,paper_id" },
    );
  if (error) return json({ error: "시작 기록에 실패했어요." }, 500);

  return json({ success: true, startedAt });
});
