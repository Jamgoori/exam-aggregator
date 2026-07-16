import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubjectWrongNoteQuestions,
  fetchQuestionMedia,
  REVIEW_COOLDOWN_HOURS,
} from "@/lib/wrong-notes";
import { representativePaperIds } from "@/lib/dedup-papers";
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
  input: { subjectSlug: string; onlyUnresolved: boolean; onlyDue?: boolean; limit?: number },
): Promise<{ sessionId?: string; error?: string }> {
  const note = await getSubjectWrongNoteQuestions(supabase, userId, input.subjectSlug);
  if (!note) return { error: "과목을 찾을 수 없어요." };

  // 이미지가 있는 문항만 출제 가능(문제를 보여줄 수 없으면 못 푼다).
  let candidates = note.questions.filter((q) => q.images.length > 0);
  if (input.onlyUnresolved) candidates = candidates.filter((q) => !q.resolved);
  // 복습 모드: 마지막으로 푼 지 하루 지난 미극복 오답만(간격 반복 lite).
  if (input.onlyDue) {
    const cutoff = new Date(
      Date.now() - REVIEW_COOLDOWN_HOURS * 3600 * 1000,
    ).toISOString();
    candidates = candidates.filter((q) => q.lastWrongAt <= cutoff);
  }
  if (candidates.length === 0) {
    return {
      error: input.onlyDue
        ? "지금 복습할 문항이 없어요. 하루 뒤에 다시 확인해보세요."
        : input.onlyUnresolved
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

function chunkIds<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// 전 과목 오답을 한 번에 모아 섞어풀기 후보(문제지, 문항)를 뽑는다. 과목을 가리지
// 않으므로 회독을 끝낸 뒤 몰아 푸는 사용자가 여러 과목을 한 세션으로 풀 수 있다.
// - onlyDue: 마지막으로 푼 지 하루 지난 것만(복습).
// - includeResolved: 이미 극복한 문항도 포함(다시 풀고 싶은 사람용).
// user_question_status(본인 RLS) + dedup 대표로 접고, 이미지가 있는(풀 수 있는) 문항만.
export async function collectAllReviewCandidates(
  supabase: Supabase,
  userId: string,
  opts: { onlyDue?: boolean; includeResolved?: boolean },
): Promise<{ paperId: string; questionNumber: number }[]> {
  const statusRows: {
    paper_id: string;
    question_number: number;
    last_is_correct: boolean;
    last_answered_at: string;
  }[] = [];
  {
    let from = 0;
    const SIZE = 1000;
    while (true) {
      const { data } = await supabase
        .from("user_question_status")
        .select("paper_id, question_number, last_is_correct, last_answered_at")
        .eq("user_id", userId)
        .gt("wrong_count", 0)
        .range(from, from + SIZE - 1);
      if (!data || data.length === 0) break;
      statusRows.push(...(data as typeof statusRows));
      if (data.length < SIZE) break;
      from += SIZE;
    }
  }
  if (statusRows.length === 0) return [];

  const paperIds = [...new Set(statusRows.map((r) => r.paper_id))];

  type PaperMeta = {
    id: string;
    subject_id: string;
    exam_type_id: string;
    year: number;
    round: number;
    level: string | null;
  };
  const papers: PaperMeta[] = [];
  for (const ids of chunkIds(paperIds, 100)) {
    const { data } = await supabase
      .from("exam_papers")
      .select("id, subject_id, exam_type_id, year, round, level")
      .in("id", ids);
    for (const p of (data ?? []) as PaperMeta[]) papers.push(p);
  }
  const { repByPaperId } = representativePaperIds(
    papers.map((p) => ({ ...p, title: "" })),
  );
  const repId = (paperId: string) => repByPaperId.get(paperId) ?? paperId;

  // (대표, 문항)별 최신 상태로 접기.
  const byRepQ = new Map<string, { resolved: boolean; at: string }>();
  for (const r of statusRows) {
    const key = `${repId(r.paper_id)}#${r.question_number}`;
    const ex = byRepQ.get(key);
    if (!ex || r.last_answered_at > ex.at) {
      byRepQ.set(key, { resolved: r.last_is_correct, at: r.last_answered_at });
    }
  }

  const repIds = [...new Set([...byRepQ.keys()].map((k) => k.split("#")[0]))];
  const mediaByPaper = await fetchQuestionMedia(supabase, repIds);
  const cutoff = opts.onlyDue
    ? new Date(Date.now() - REVIEW_COOLDOWN_HOURS * 3600 * 1000).toISOString()
    : null;

  const candidates: { paperId: string; questionNumber: number }[] = [];
  for (const [key, v] of byRepQ) {
    if (!opts.includeResolved && v.resolved) continue;
    if (cutoff && v.at > cutoff) continue;
    const [rep, qnumStr] = key.split("#");
    const qnum = Number(qnumStr);
    if (!mediaByPaper.get(rep)?.get(qnum)?.images.length) continue; // 풀 수 있는 것만
    candidates.push({ paperId: rep, questionNumber: qnum });
  }
  return candidates;
}

// 선택한 시험지들의 "틀린 문제(이미지 있는)"를 모아 후보로 뽑는다. 시험지 하나면
// 시험지별 다시풀기, 여러 개면 합쳐 풀기. 극복 여부와 무관하게 그 시험지에서 틀렸던
// 문항 전체를 담는다("틀린 문제 다시 풀기"라는 뜻에 맞춤).
export async function collectPaperReviewCandidates(
  supabase: Supabase,
  userId: string,
  paperIds: string[],
): Promise<{ paperId: string; questionNumber: number }[]> {
  if (paperIds.length === 0) return [];
  const rows: { paper_id: string; question_number: number }[] = [];
  for (const ids of chunkIds(paperIds, 100)) {
    const { data } = await supabase
      .from("user_question_status")
      .select("paper_id, question_number")
      .eq("user_id", userId)
      .in("paper_id", ids)
      .gt("wrong_count", 0);
    for (const r of (data ?? []) as typeof rows) rows.push(r);
  }
  if (rows.length === 0) return [];

  const mediaByPaper = await fetchQuestionMedia(supabase, paperIds);
  const seen = new Set<string>();
  const items: { paperId: string; questionNumber: number }[] = [];
  for (const r of rows) {
    if (!mediaByPaper.get(r.paper_id)?.get(r.question_number)?.images.length) continue;
    const key = `${r.paper_id}#${r.question_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ paperId: r.paper_id, questionNumber: r.question_number });
  }
  return items;
}

export async function createPaperReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  paperIds: string[],
): Promise<{ sessionId?: string; error?: string }> {
  const items = await collectPaperReviewCandidates(supabase, userId, paperIds);
  if (items.length === 0) {
    return { error: "다시 풀 (이미지가 있는) 틀린 문제가 없어요." };
  }
  return createReviewSessionFromItems(supabase, userId, items);
}

// 전 과목 섞어풀기/복습 세션 생성. 후보를 모아 createReviewSessionFromItems로 넘긴다.
export async function createAllReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  opts: { onlyDue?: boolean; includeResolved?: boolean },
): Promise<{ sessionId?: string; error?: string }> {
  const items = await collectAllReviewCandidates(supabase, userId, opts);
  if (items.length === 0) {
    return {
      error: opts.onlyDue
        ? "지금 복습할 문항이 없어요. 하루 뒤에 다시 확인해보세요."
        : opts.includeResolved
          ? "다시 풀 문항이 없어요."
          : "아직 안 극복한(이미지가 있는) 오답이 없어요.",
    };
  }
  return createReviewSessionFromItems(supabase, userId, items);
}

// 채점 결과에서 "틀린 문항만 다시 풀기": 넘겨받은 (문제지, 문항) 목록으로 새 세션을
// 만든다. 정답·이미지는 채점/렌더 시점에 서버가 다시 조회하므로 목록엔 정답이 없다.
//
// 보안: items는 클라이언트가 그대로 보내므로 신뢰하지 않는다. 반드시 "이 사용자가
// 실제로 틀린 적 있는 문항"(user_question_status.wrong_count>0, 본인 RLS)과 교집합만
// 남긴다. 이 검증이 없으면, 채점 후 세션 뷰가 정답(correctChoice)을 내려주는 성질을
// 악용해 응시한 적 없는 임의 문제지의 정답표(paper_answers)를 통째로 뽑아낼 수 있다
// (다른 후보 빌더들은 애초에 본인 통계에서 목록을 만들어 이 문제가 없다).
export async function createReviewSessionFromItems(
  supabase: Supabase,
  userId: string,
  items: { paperId: string; questionNumber: number }[],
): Promise<{ sessionId?: string; error?: string }> {
  const seen = new Set<string>();
  const requested: { paperId: string; questionNumber: number }[] = [];
  for (const it of items) {
    if (!it?.paperId || !Number.isInteger(it?.questionNumber)) continue;
    const key = `${it.paperId}#${it.questionNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requested.push({ paperId: it.paperId, questionNumber: it.questionNumber });
  }
  if (requested.length === 0) return { error: "다시 풀 문항이 없어요." };

  // 본인이 틀린 적 있는 (문제지, 문항)만 통과시킨다(RLS로 본인 행만 조회됨).
  const requestedPaperIds = [...new Set(requested.map((r) => r.paperId))];
  const ownedWrong = new Set<string>();
  for (const ids of chunkIds(requestedPaperIds, 100)) {
    const { data } = await supabase
      .from("user_question_status")
      .select("paper_id, question_number")
      .eq("user_id", userId)
      .in("paper_id", ids)
      .gt("wrong_count", 0);
    for (const r of (data ?? []) as { paper_id: string; question_number: number }[]) {
      ownedWrong.add(`${r.paper_id}#${r.question_number}`);
    }
  }
  const clean = requested.filter((r) => ownedWrong.has(`${r.paperId}#${r.questionNumber}`));
  if (clean.length === 0) return { error: "다시 풀 문항이 없어요." };

  const picked = shuffle(clean).slice(0, MAX_LIMIT);
  const admin = createAdminClient();
  const { data: session, error: sessionError } = await admin
    .from("review_sessions")
    .insert({
      user_id: userId,
      subject_id: null,
      scope: "subject",
      only_unresolved: true,
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

  // 제출을 원자적으로 "선점"한다: submitted_at이 아직 null인 행에만 기록하고, 실제로
  // 갱신된 행을 돌려받는다. 동시에 두 번 제출(더블탭·두 탭·재시도)되면 두 번째는
  // 여기서 0행이라, 아래 문항 통합 상태 갱신(recordQuestionResults, 읽고-쓰는 증분)이
  // 두 번 돌아 wrong_count가 두 배로 뛰는 사고를 막는다.
  const { data: claimed } = await admin
    .from("review_sessions")
    .update({ score, submitted_at: new Date().toISOString() })
    .eq("id", sessionId)
    .is("submitted_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) {
    // 다른 요청이 먼저 제출을 끝냈다. 현재 채점 결과만 다시 읽어 돌려준다.
    const view = await getReviewSessionView(supabase, userId, sessionId);
    return view ? { view } : { error: "이미 채점된 세션이에요." };
  }

  // 문항 통합 상태 갱신(극복 판정). 문제지별로 묶어 한 번씩. 실패해도 채점은 유효.
  // 사용자가 실제로 답을 고른 문항만 반영한다 — 섞어풀기에서 그냥 넘긴(풀지 않음,
  // selected=null) 문항까지 오답으로 기록하면, 예전에 극복해 둔 문항이 "풀지 않았다"는
  // 이유만으로 다시 미극복으로 뒤집히고 wrong_count가 부풀기 때문이다(부분 채점·조기
  // 채점이 정상 흐름이라 실제로 자주 발생). 스킵 문항은 신호가 없으니 상태를 건드리지
  // 않는다(정답/오답 판정은 이 세션 결과 화면에만 반영). voided(전항정답) 문항도 답을
  // 고른 경우에만 정답으로 기록된다.
  const byPaper = new Map<string, { question_number: number; is_correct: boolean }[]>();
  for (const r of gradedRows) {
    if (r.selected_choice === null) continue;
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
