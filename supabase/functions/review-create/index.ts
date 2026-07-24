// 섞어풀기 세션 생성. 웹 review-session.ts(createAllReviewSessionForUser)의 v1 포팅.
// 내 오답(이미지가 있는) 중 무작위로 뽑아 review_sessions/items 를 만든다. 응답에는
// 정답·출처를 절대 싣지 않는다(힌트 방지) — 이미지·선지 수만.
//
// ⚠️ 웹은 dedup(중복 시험지)·수동 표시·복습 쿨다운까지 반영한다. 이 v1 은 그걸
// 단순화했다(user_question_status wrong_count>0 기준). 상세 규칙은 웹 참고.
import { corsHeaders, json } from "../_shared/cbt.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";
import { fetchQuestionMedia } from "../_shared/media.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  let onlyUnresolved = true;
  let limit = DEFAULT_LIMIT;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.onlyUnresolved === "boolean") onlyUnresolved = body.onlyUnresolved;
    if (Number.isInteger(body?.limit)) limit = body.limit;
  } catch {
    // 기본값 사용
  }
  limit = Math.min(Math.max(1, limit), MAX_LIMIT);

  const admin = adminClient();

  // 내 오답 문항.
  let q = admin
    .from("user_question_status")
    .select("paper_id, question_number")
    .eq("user_id", userId)
    .gt("wrong_count", 0);
  if (onlyUnresolved) q = q.eq("last_is_correct", false);
  const { data: statusRows, error } = await q;
  if (error) return json({ error: "오답을 불러오지 못했어요." }, 500);

  const rows = (statusRows ?? []) as { paper_id: string; question_number: number }[];
  if (rows.length === 0) {
    return json({ error: "다시 풀 오답이 없어요." }, 400);
  }

  // 이미지가 있는 문항만 출제 가능.
  const paperIds = [...new Set(rows.map((r) => r.paper_id))];
  const media = await fetchQuestionMedia(admin, paperIds);
  const candidates = rows.filter(
    (r) => (media.get(r.paper_id)?.get(r.question_number)?.images.length ?? 0) > 0,
  );
  if (candidates.length === 0) {
    return json({ error: "다시 풀 (이미지가 있는) 오답이 없어요." }, 400);
  }

  const picked = shuffle(candidates).slice(0, limit);

  const { data: session, error: sErr } = await admin
    .from("review_sessions")
    .insert({
      user_id: userId,
      subject_id: null,
      scope: "subject",
      only_unresolved: onlyUnresolved,
      total_questions: picked.length,
    })
    .select("id")
    .single();
  if (sErr || !session) return json({ error: "세션 생성에 실패했어요." }, 500);

  const { error: iErr } = await admin.from("review_session_items").insert(
    picked.map((c, i) => ({
      session_id: session.id,
      paper_id: c.paper_id,
      question_number: c.question_number,
      position: i,
      selected_choice: null,
      is_correct: null,
    })),
  );
  if (iErr) {
    await admin.from("review_sessions").delete().eq("id", session.id);
    return json({ error: "세션 생성에 실패했어요." }, 500);
  }

  // 풀이용 응답 — 정답/출처 없음.
  const items = picked.map((c, i) => {
    const m = media.get(c.paper_id)?.get(c.question_number);
    return {
      position: i,
      images: m?.images ?? [],
      choiceCount: m?.choiceCount ?? 4,
    };
  });

  return json({ sessionId: session.id, total: picked.length, items });
});
