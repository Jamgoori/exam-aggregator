// 문제지 해설. 웹 papers/[id]/explanations/page.tsx 포팅. paper_answers(정답)와
// question_explanations 는 둘 다 admin 전용 RLS(일반 select 완전 차단)라 service_role
// 로만 읽는다 — CBT 채점과 같은 이유(정답 유출 방지).
//
// 접근 규칙(웹과 동일):
//  - 비로그인: 미리보기 ANON_PREVIEW_CARDS 문항만.
//  - 로그인: 시간당 조회 40회 넘으면(explanation_access_log, admin 전용) 마찬가지로
//    미리보기만 — 계정 만들어 문제지 ID 순회 크롤링을 늦추는 목적, 정상 사용자는
//    걸릴 일 없음. 조회 자체는 막지 않고 "잠시 후" 로만 안내.
import { corsHeaders, isUuid, json } from "../_shared/cbt.ts";
import { adminClient, getOptionalUser, storagePublicUrl } from "../_shared/clients.ts";
import { toExplanationContent } from "../_shared/explanations.ts";

const ANON_PREVIEW_CARDS = 2;
const VIEW_HOURLY_LIMIT = 40;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let paperId = "";
  try {
    const body = await req.json().catch(() => ({}));
    paperId = String(body?.paperId ?? "");
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (!isUuid(paperId)) return json({ error: "잘못된 접근입니다." }, 400);

  const admin = adminClient();
  const userId = await getOptionalUser(req);
  const loggedIn = !!userId;

  let withinRateLimit = true;
  if (loggedIn) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await admin
      .from("explanation_access_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", "view")
      .gte("created_at", oneHourAgo);
    withinRateLimit = (count ?? 0) < VIEW_HOURLY_LIMIT;
    if (withinRateLimit) {
      await admin
        .from("explanation_access_log")
        .insert({ user_id: userId, paper_id: paperId, action: "view" });
    }
  }
  const hasFullAccess = loggedIn && withinRateLimit;

  // 정답.
  const { data: paperAnswers } = await admin
    .from("paper_answers")
    .select("answers")
    .eq("paper_id", paperId)
    .maybeSingle();
  const correctAnswers = (paperAnswers?.answers ?? []) as number[];

  // 문항 이미지·선지 수.
  const { data: questionRows } = await admin
    .from("questions")
    .select("id, question_number, choice_count, question_images(order_index, image_path)")
    .eq("paper_id", paperId);

  const mediaByNumber = new Map<
    number,
    { images: string[]; choiceCount: number; questionId: string }
  >();
  for (const q of questionRows ?? []) {
    const images = [...((q.question_images as
      | { order_index: number; image_path: string }[]
      | null) ?? [])]
      .sort((a, b) => a.order_index - b.order_index)
      .map((img) => storagePublicUrl(img.image_path));
    mediaByNumber.set(q.question_number, {
      images,
      choiceCount: q.choice_count,
      questionId: q.id,
    });
  }
  const questionIds = (questionRows ?? []).map((q: { id: string }) => q.id);

  // 해설(question_id → 문항). 같은 문항에 여러 번 생성됐으면 최신(created_at 오름차순
  // 마지막)으로 덮어쓴다.
  const explanationByQuestionId = new Map<string, ReturnType<typeof toExplanationContent>>();
  if (questionIds.length > 0) {
    const { data: expRows } = await admin
      .from("question_explanations")
      .select(
        "question_id, created_at, keyword_title, keyword_explanation, choice_explanations, correct_choice_summary, law_amendment_note, current_answer_status, current_answer_note, law_basis_date",
      )
      .in("question_id", questionIds)
      .order("created_at", { ascending: true });
    for (const row of expRows ?? []) {
      const content = toExplanationContent(row);
      if (content) explanationByQuestionId.set(row.question_id, content);
    }
  }

  type QuestionOut = {
    questionNumber: number;
    correctChoice: number | null;
    choiceCount: number;
    images: string[];
    explanation: NonNullable<ReturnType<typeof toExplanationContent>>;
  };
  const questions: QuestionOut[] = [];
  for (const q of questionRows ?? []) {
    const explanation = explanationByQuestionId.get(q.id);
    if (!explanation) continue; // 해설 없는 문항은 뺀다(웹과 동일).
    const media = mediaByNumber.get(q.question_number);
    questions.push({
      questionNumber: q.question_number,
      correctChoice: correctAnswers[q.question_number - 1] ?? null,
      choiceCount: media?.choiceCount ?? q.choice_count,
      images: media?.images ?? [],
      explanation,
    });
  }
  questions.sort((a, b) => a.questionNumber - b.questionNumber);

  const totalCount = questions.length;
  const visible = hasFullAccess ? questions : questions.slice(0, ANON_PREVIEW_CARDS);
  const hiddenCount = totalCount - visible.length;

  return json({
    questions: visible,
    totalCount,
    hiddenCount,
    hasFullAccess,
    loggedIn,
  });
});
