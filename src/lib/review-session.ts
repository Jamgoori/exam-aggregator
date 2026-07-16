import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubjectWrongNoteQuestions,
  fetchQuestionMedia,
} from "@/lib/wrong-notes";
import { recordQuestionResults } from "@/lib/question-status";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 섞어풀기: 오답노트에서 고른 틀린 문항을 무작위로 다시 푸는 세션. 정답/채점 결과가
// 담긴 review_sessions·review_session_items는 클라이언트 직접 접근이 막혀 있어(RLS
// 정책 0개) 이 파일이 service_role로만 읽고 쓴다. 화면에는 채점 전까지 정답·출처를
// 절대 싣지 않는다(힌트 방지).

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export type ReviewItemView = {
  position: number;
  images: string[];
  choiceCount: number;
  // 채점 후에만 채워진다(풀이 중엔 전부 null — 출처·정답 노출 금지).
  selectedChoice: number | null;
  correctChoice: number | null;
  isCorrect: boolean | null;
  paperId: string | null;
  paperTitle: string | null;
  questionNumber: number | null;
};

export type ReviewSessionView = {
  id: string;
  subjectSlug: string | null;
  subjectName: string | null;
  total: number;
  score: number | null;
  submitted: boolean;
  items: ReviewItemView[];
};

type ItemRow = {
  id: string;
  paper_id: string;
  question_number: number;
  position: number;
  selected_choice: number | null;
  is_correct: boolean | null;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 섞어풀기 세션을 만든다: 해당 과목의 (이미지가 있어 풀 수 있는) 오답을 골라 섞고
// limit개로 잘라 세션+문항을 저장한다. 풀 문항이 없으면 error.
export async function createReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  input: { subjectSlug: string; onlyUnresolved: boolean; limit?: number },
): Promise<{ sessionId?: string; error?: string }> {
  const note = await getSubjectWrongNoteQuestions(supabase, userId, input.subjectSlug);
  if (!note) return { error: "과목을 찾을 수 없어요." };

  // 이미지가 있는 문항만 출제 가능(문제를 보여줄 수 없으면 못 푼다).
  let candidates = note.questions.filter((q) => q.images.length > 0);
  if (input.onlyUnresolved) candidates = candidates.filter((q) => !q.resolved);
  if (candidates.length === 0) {
    return {
      error: input.onlyUnresolved
        ? "아직 안 극복한(이미지가 있는) 오답이 없어요."
        : "이 과목에 다시 풀 오답이 없어요.",
    };
  }

  const limit = Math.min(Math.max(1, input.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const picked = shuffle(candidates).slice(0, limit);

  const admin = createAdminClient();
  const { data: session, error: sessionError } = await admin
    .from("review_sessions")
    .insert({
      user_id: userId,
      subject_id: note.subject.id,
      scope: "subject",
      only_unresolved: input.onlyUnresolved,
      total_questions: picked.length,
    })
    .select("id")
    .single();
  if (sessionError || !session) return { error: "세션 생성에 실패했어요." };

  const { error: itemsError } = await admin.from("review_session_items").insert(
    picked.map((q, i) => ({
      session_id: session.id as string,
      paper_id: q.paperId,
      question_number: q.questionNumber,
      position: i,
      selected_choice: null,
      is_correct: null,
    })),
  );
  if (itemsError) {
    await admin.from("review_sessions").delete().eq("id", session.id);
    return { error: "세션 생성에 실패했어요." };
  }

  return { sessionId: session.id as string };
}

// 세션 하나를 화면용으로 읽는다. 본인 세션이 아니면 null. 채점 전이면 정답·출처는
// 전부 null로 가린다.
export async function getReviewSessionView(
  supabase: Supabase,
  userId: string,
  sessionId: string,
): Promise<ReviewSessionView | null> {
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("review_sessions")
    .select("id, user_id, subject_id, total_questions, score, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) return null;

  const { data: itemRows } = await admin
    .from("review_session_items")
    .select("id, paper_id, question_number, position, selected_choice, is_correct")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  const items = (itemRows ?? []) as ItemRow[];

  const submitted = session.submitted_at != null;
  const paperIds = [...new Set(items.map((i) => i.paper_id))];

  // 이미지·선지 수는 항상 필요(문제를 그려야 하므로). 정답·제목은 채점 후에만.
  const mediaByPaper = await fetchQuestionMedia(supabase, paperIds);

  const paperMeta = new Map<string, { title: string; choiceCount: number }>();
  if (paperIds.length > 0) {
    const { data: papers } = await supabase
      .from("exam_papers")
      .select("id, title, choice_count")
      .in("id", paperIds);
    for (const p of papers ?? []) {
      paperMeta.set(p.id as string, {
        title: p.title as string,
        choiceCount: p.choice_count as number,
      });
    }
  }

  const answersByPaper = new Map<string, number[]>();
  if (submitted && paperIds.length > 0) {
    const { data: ans } = await admin
      .from("paper_answers")
      .select("paper_id, answers")
      .in("paper_id", paperIds);
    for (const row of ans ?? []) {
      answersByPaper.set(row.paper_id as string, (row.answers ?? []) as number[]);
    }
  }

  let subjectSlug: string | null = null;
  let subjectName: string | null = null;
  if (session.subject_id) {
    const { data: subj } = await supabase
      .from("subjects")
      .select("slug, name")
      .eq("id", session.subject_id)
      .maybeSingle();
    if (subj) {
      subjectSlug = subj.slug as string;
      subjectName = subj.name as string;
    }
  }

  const viewItems: ReviewItemView[] = items.map((it) => {
    const media = mediaByPaper.get(it.paper_id)?.get(it.question_number);
    const meta = paperMeta.get(it.paper_id);
    return {
      position: it.position,
      images: media?.images ?? [],
      choiceCount: media?.choiceCount ?? meta?.choiceCount ?? 4,
      selectedChoice: submitted ? it.selected_choice : null,
      correctChoice: submitted
        ? (answersByPaper.get(it.paper_id)?.[it.question_number - 1] ?? null)
        : null,
      isCorrect: submitted ? it.is_correct : null,
      paperId: submitted ? it.paper_id : null,
      paperTitle: submitted ? (meta?.title ?? null) : null,
      questionNumber: submitted ? it.question_number : null,
    };
  });

  return {
    id: session.id as string,
    subjectSlug,
    subjectName,
    total: session.total_questions as number,
    score: (session.score as number | null) ?? null,
    submitted,
    items: viewItems,
  };
}

// 섞어풀기 채점. 서버가 정답을 조회해 채점하고, 문항 통합 상태(source='review')에
// 반영한 뒤 채점된 세션 뷰를 돌려준다. 이미 채점됐거나 남의 세션이면 error.
export async function submitReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  sessionId: string,
  answers: (number | null)[],
): Promise<{ error?: string; view?: ReviewSessionView }> {
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("review_sessions")
    .select("id, user_id, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) return { error: "세션을 찾을 수 없어요." };
  if (session.submitted_at != null) return { error: "이미 채점된 세션이에요." };

  const { data: itemRows } = await admin
    .from("review_session_items")
    .select("id, session_id, paper_id, question_number, position, selected_choice, is_correct")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  const items = (itemRows ?? []) as (ItemRow & { session_id: string })[];
  if (items.length === 0) return { error: "세션에 문항이 없어요." };

  const paperIds = [...new Set(items.map((i) => i.paper_id))];
  const answersByPaper = new Map<string, number[]>();
  const voidedByPaper = new Map<string, Set<number>>();
  const { data: ans } = await admin
    .from("paper_answers")
    .select("paper_id, answers, voided_questions")
    .in("paper_id", paperIds);
  for (const row of ans ?? []) {
    answersByPaper.set(row.paper_id as string, (row.answers ?? []) as number[]);
    voidedByPaper.set(
      row.paper_id as string,
      new Set((row.voided_questions ?? []) as number[]),
    );
  }

  let score = 0;
  const gradedRows = items.map((it) => {
    const selected =
      typeof answers[it.position] === "number" ? (answers[it.position] as number) : null;
    const correct = answersByPaper.get(it.paper_id)?.[it.question_number - 1];
    const isCorrect =
      voidedByPaper.get(it.paper_id)?.has(it.question_number) === true ||
      (selected !== null && selected === correct);
    if (isCorrect) score++;
    return {
      id: it.id,
      session_id: it.session_id,
      paper_id: it.paper_id,
      question_number: it.question_number,
      position: it.position,
      selected_choice: selected,
      is_correct: isCorrect,
    };
  });

  const { error: upsertError } = await admin
    .from("review_session_items")
    .upsert(gradedRows, { onConflict: "id" });
  if (upsertError) return { error: "채점 저장에 실패했어요." };

  await admin
    .from("review_sessions")
    .update({ score, submitted_at: new Date().toISOString() })
    .eq("id", sessionId);

  // 문항 통합 상태 갱신(극복 판정). 문제지별로 묶어 한 번씩. 실패해도 채점은 유효.
  const byPaper = new Map<string, { question_number: number; is_correct: boolean }[]>();
  for (const r of gradedRows) {
    const list = byPaper.get(r.paper_id) ?? [];
    list.push({ question_number: r.question_number, is_correct: r.is_correct });
    byPaper.set(r.paper_id, list);
  }
  try {
    for (const [paperId, results] of byPaper) {
      await recordQuestionResults(supabase, userId, paperId, results, "review");
    }
  } catch {
    // 무시: 상태 갱신 실패가 채점을 막지 않는다.
  }

  const view = await getReviewSessionView(supabase, userId, sessionId);
  return { view: view ?? undefined };
}
