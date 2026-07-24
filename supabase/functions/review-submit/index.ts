// 섞어풀기 채점. 웹 submitReviewSessionForUser 포팅. 서버가 정답을 조회해 채점하고
// review_session_items/sessions 를 갱신, user_question_status(source='review')에 반영.
// 채점된 뷰(정답·출처 포함)를 돌려준다.
import { corsHeaders, json, sanitizeSelectedChoice } from "../_shared/cbt.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";
import { fetchQuestionMedia } from "../_shared/media.ts";
import { recordQuestionResults } from "../_shared/status.ts";

type ItemRow = {
  id: string;
  paper_id: string;
  question_number: number;
  position: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  let sessionId = "";
  let answers: (number | null)[] = [];
  try {
    const body = await req.json();
    sessionId = String(body?.sessionId ?? "");
    answers = Array.isArray(body?.answers) ? body.answers : [];
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (!sessionId) return json({ error: "잘못된 접근입니다." }, 400);

  const admin = adminClient();

  const { data: session } = await admin
    .from("review_sessions")
    .select("id, user_id, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) {
    return json({ error: "세션을 찾을 수 없어요." }, 404);
  }
  if (session.submitted_at != null) return json({ error: "이미 채점된 세션이에요." }, 400);

  const { data: itemRows } = await admin
    .from("review_session_items")
    .select("id, paper_id, question_number, position")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  const items = (itemRows ?? []) as ItemRow[];
  if (items.length === 0) return json({ error: "세션에 문항이 없어요." }, 400);

  const paperIds = [...new Set(items.map((i) => i.paper_id))];

  // 정답·전항정답.
  const answersByPaper = new Map<string, number[]>();
  const voidedByPaper = new Map<string, Set<number>>();
  {
    const { data: ans } = await admin
      .from("paper_answers")
      .select("paper_id, answers, voided_questions")
      .in("paper_id", paperIds);
    for (const row of ans ?? []) {
      answersByPaper.set(row.paper_id, (row.answers ?? []) as number[]);
      voidedByPaper.set(row.paper_id, new Set((row.voided_questions ?? []) as number[]));
    }
  }

  let score = 0;
  const graded = items.map((it) => {
    const selected = sanitizeSelectedChoice(answers[it.position]);
    const correct = answersByPaper.get(it.paper_id)?.[it.question_number - 1];
    const isCorrect =
      voidedByPaper.get(it.paper_id)?.has(it.question_number) === true ||
      (selected !== null && selected === correct);
    if (isCorrect) score++;
    return {
      id: it.id,
      session_id: sessionId,
      paper_id: it.paper_id,
      question_number: it.question_number,
      position: it.position,
      selected_choice: selected,
      is_correct: isCorrect,
    };
  });

  const { error: upErr } = await admin
    .from("review_session_items")
    .upsert(graded, { onConflict: "id" });
  if (upErr) return json({ error: "채점 저장에 실패했어요." }, 500);

  await admin
    .from("review_sessions")
    .update({ score, submitted_at: new Date().toISOString() })
    .eq("id", sessionId);

  // 극복 판정(문제지별). 실패해도 채점은 유효.
  const byPaper = new Map<string, { question_number: number; is_correct: boolean }[]>();
  for (const r of graded) {
    const list = byPaper.get(r.paper_id) ?? [];
    list.push({ question_number: r.question_number, is_correct: r.is_correct });
    byPaper.set(r.paper_id, list);
  }
  try {
    for (const [paperId, results] of byPaper) {
      await recordQuestionResults(admin, userId, paperId, results, "review");
    }
  } catch {
    // 무시
  }

  // 결과 뷰: 이미지 + 정답/선택/제목/출처.
  const media = await fetchQuestionMedia(admin, paperIds);
  const titleByPaper = new Map<string, string>();
  {
    const { data: papers } = await admin
      .from("exam_papers")
      .select("id, title")
      .in("id", paperIds);
    for (const p of papers ?? []) titleByPaper.set(p.id, p.title);
  }

  const resultItems = graded.map((r) => {
    const m = media.get(r.paper_id)?.get(r.question_number);
    return {
      position: r.position,
      images: m?.images ?? [],
      choiceCount: m?.choiceCount ?? 4,
      selectedChoice: r.selected_choice,
      correctChoice: answersByPaper.get(r.paper_id)?.[r.question_number - 1] ?? null,
      isCorrect: r.is_correct,
      paperTitle: titleByPaper.get(r.paper_id) ?? null,
      questionNumber: r.question_number,
    };
  });

  return json({ score, total: items.length, items: resultItems });
});
