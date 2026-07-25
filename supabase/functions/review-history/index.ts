// 섞어풀기 기록 조회. review_sessions / review_session_items 는 RLS 를 켜두고 정책을
// 하나도 두지 않아(schema.sql) 클라이언트가 직접 못 읽는다 — 세션에 어떤 문항이 들어
// 있는지가 곧 "정답을 아직 모르는 출제 목록"이라서다. 그래서 채점이 끝난 세션만 이
// 함수를 통해 service_role 로 돌려준다.
//
// 두 가지 응답:
//   body 없음 / { }          → 내 섞어풀기 기록 목록(채점 완료분만)
//   { sessionId }            → 그 세션의 문항별 결과(review-submit 응답과 같은 모양)
//
// 아직 채점 전(submitted_at = null)인 세션은 어느 쪽으로도 내보내지 않는다. 풀기 전에
// 정답을 미리 볼 수 있게 되면 안 되기 때문이다.
import { corsHeaders, json } from "../_shared/cbt.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";
import { fetchQuestionMedia } from "../_shared/media.ts";

const LIST_LIMIT = 50;

type ItemRow = {
  paper_id: string;
  question_number: number;
  position: number;
  selected_choice: number | null;
  is_correct: boolean | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";

  const admin = adminClient();

  // ── 목록 ──────────────────────────────────────────────────────────────────
  if (!sessionId) {
    const { data, error } = await admin
      .from("review_sessions")
      .select("id, scope, subject_id, total_questions, score, created_at, submitted_at, subjects(name)")
      .eq("user_id", userId)
      .not("submitted_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (error) return json({ error: "기록을 불러오지 못했어요." }, 500);

    const sessions = (data ?? []).map((s) => {
      const subject = s.subjects as { name: string } | { name: string }[] | null;
      const subjectName = Array.isArray(subject) ? (subject[0]?.name ?? null) : (subject?.name ?? null);
      return {
        sessionId: s.id as string,
        scope: s.scope as string,
        subjectName,
        total: s.total_questions as number,
        score: s.score as number | null,
        submittedAt: s.submitted_at as string,
      };
    });
    return json({ sessions });
  }

  // ── 세션 상세 ─────────────────────────────────────────────────────────────
  const { data: session } = await admin
    .from("review_sessions")
    .select("id, user_id, score, total_questions, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  // 남의 세션 id 로는 아무것도 나오지 않게 소유자를 명시적으로 확인한다.
  if (!session || session.user_id !== userId) {
    return json({ error: "세션을 찾을 수 없어요." }, 404);
  }
  if (session.submitted_at == null) {
    return json({ error: "아직 채점하지 않은 세션이에요." }, 400);
  }

  const { data: itemRows } = await admin
    .from("review_session_items")
    .select("paper_id, question_number, position, selected_choice, is_correct")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  const items = (itemRows ?? []) as ItemRow[];

  const paperIds = [...new Set(items.map((i) => i.paper_id))];
  const media = await fetchQuestionMedia(admin, paperIds);

  const answersByPaper = new Map<string, number[]>();
  {
    const { data: ans } = await admin
      .from("paper_answers")
      .select("paper_id, answers")
      .in("paper_id", paperIds);
    for (const row of ans ?? []) {
      answersByPaper.set(row.paper_id, (row.answers ?? []) as number[]);
    }
  }

  const titleByPaper = new Map<string, string>();
  {
    const { data: papers } = await admin
      .from("exam_papers")
      .select("id, title")
      .in("id", paperIds);
    for (const p of papers ?? []) titleByPaper.set(p.id, p.title);
  }

  const resultItems = items.map((r) => {
    const m = media.get(r.paper_id)?.get(r.question_number);
    return {
      position: r.position,
      images: m?.images ?? [],
      choiceCount: m?.choiceCount ?? 4,
      selectedChoice: r.selected_choice,
      correctChoice: answersByPaper.get(r.paper_id)?.[r.question_number - 1] ?? null,
      isCorrect: r.is_correct === true,
      paperTitle: titleByPaper.get(r.paper_id) ?? null,
      questionNumber: r.question_number,
    };
  });

  return json({
    score: session.score ?? 0,
    total: session.total_questions ?? items.length,
    items: resultItems,
  });
});
