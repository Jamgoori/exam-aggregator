import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubjectWrongNoteQuestions,
  fetchQuestionMedia,
  fetchWrongNoteMarks,
  REVIEW_COOLDOWN_HOURS,
} from "@/lib/wrong-notes";
import { representativePaperIds } from "@/lib/dedup-papers";
import { recordQuestionResults } from "@/lib/question-status";
import { recordAttendance } from "@/lib/attendance";
import { resolveStatusTargets, statusTargetKey } from "@/lib/status-targets";
import { sanitizeSelectedChoice } from "@/lib/cbt-attempt";
import {
  pickReviewCandidates,
  srsGuessed,
  srsStateFromRow,
  type ReviewPickStrategy,
  attendanceQuestionCount,
} from "@gongmoa/core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 섞어풀기: 오답노트에서 고른 틀린 문항을 무작위로 다시 푸는 세션. 정답/채점 결과가
// 담긴 review_sessions·review_session_items는 클라이언트 직접 접근이 막혀 있어(RLS
// 정책 0개) 이 파일이 service_role로만 읽고 쓴다. 화면에는 채점 전까지 정답·출처를
// 절대 싣지 않는다(힌트 방지).

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// review_sessions.scope 값. 복습(간격 반복) 세션만 이걸 쓴다.
const DUE_SCOPE = "due";

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
  // 맞혔지만 "찍었어요"로 표시한 문항. 채점 후에만 의미가 있다.
  guessed: boolean;
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
  guessed?: boolean | null;
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 섞어풀기 세션을 만든다: 해당 과목의 (이미지가 있어 풀 수 있는) 오답에서 limit개를
// 골라 세션+문항을 저장한다. 풀 문항이 없으면 error.
//
// 뽑기는 균등 무작위가 아니라 층 정원제(review-pick.ts)다. 오답이 수백 개 쌓이면
// 균등 추출은 "2번 틀린 문제"와 "반년 전 한 번 틀린 문제"를 같은 확률로 내보내
// 정작 위험한 문항을 만날 확률을 계속 희석시킨다. strategy: "random"을 주면 기존
// 균등 추출로 돌아간다(화면의 "전체 랜덤" 칩).
export async function createReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  input: {
    subjectSlug: string;
    onlyUnresolved: boolean;
    onlyDue?: boolean;
    limit?: number;
    strategy?: ReviewPickStrategy;
  },
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
  const picked = pickReviewCandidates(candidates, limit, input.strategy ?? "weighted");

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
//
// wrongCount·lastWrongAt까지 함께 돌려주는 건 층 정원제 추출(review-pick.ts)의
// 재료이기 때문이다. lastWrongAt은 last_answered_at을 그대로 쓴다 — 기본값인
// 미극복 후보에서는 마지막 응답이 곧 마지막 오답이라 같은 값이다(includeResolved로
// 극복 문항까지 담을 때만 "마지막으로 푼 시각"에 가까워지는데, 그 문항은 어차피
// 위험도가 낮아 층이 어긋나도 손해가 없다).
export type AllReviewCandidate = {
  paperId: string;
  questionNumber: number;
  wrongCount: number;
  lastWrongAt: string;
};

export async function collectAllReviewCandidates(
  supabase: Supabase,
  userId: string,
  opts: { onlyDue?: boolean; includeResolved?: boolean },
): Promise<AllReviewCandidate[]> {
  const statusRows: {
    paper_id: string;
    question_number: number;
    last_is_correct: boolean;
    last_answered_at: string;
    wrong_count: number | null;
  }[] = [];
  {
    let from = 0;
    const SIZE = 1000;
    while (true) {
      const { data } = await supabase
        .from("user_question_status")
        .select("paper_id, question_number, last_is_correct, last_answered_at, wrong_count")
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

  const marks = await fetchWrongNoteMarks(supabase, userId);

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

  // 완전 삭제 마크를 대표 키로 정규화해 후보에서 뺀다.
  const deletedRepKeys = new Set<string>();
  for (const k of marks.deleted) {
    const idx = k.lastIndexOf("#");
    deletedRepKeys.add(`${repId(k.slice(0, idx))}#${k.slice(idx + 1)}`);
  }

  // (대표, 문항)별 최신 상태로 접기. 틀린 횟수는 최신 행의 값이 아니라 접힌 행들의
  // 최댓값을 쓴다 — 같은 문항을 중복 시험지로 나눠 응시했으면 어느 한 행만 봐서는
  // "몇 번 무너진 문항인지"가 실제보다 작게 나온다.
  const byRepQ = new Map<string, { resolved: boolean; at: string; wrongCount: number }>();
  for (const r of statusRows) {
    const key = `${repId(r.paper_id)}#${r.question_number}`;
    if (deletedRepKeys.has(key)) continue;
    const ex = byRepQ.get(key);
    const wrongCount = Math.max(ex?.wrongCount ?? 0, r.wrong_count ?? 0);
    if (!ex || r.last_answered_at > ex.at) {
      byRepQ.set(key, { resolved: r.last_is_correct, at: r.last_answered_at, wrongCount });
    } else {
      ex.wrongCount = wrongCount;
    }
  }

  const repIds = [...new Set([...byRepQ.keys()].map((k) => k.split("#")[0]))];
  const mediaByPaper = await fetchQuestionMedia(supabase, repIds);
  const cutoff = opts.onlyDue
    ? new Date(Date.now() - REVIEW_COOLDOWN_HOURS * 3600 * 1000).toISOString()
    : null;

  const candidates: AllReviewCandidate[] = [];
  for (const [key, v] of byRepQ) {
    if (!opts.includeResolved && v.resolved) continue;
    if (cutoff && v.at > cutoff) continue;
    const [rep, qnumStr] = key.split("#");
    const qnum = Number(qnumStr);
    if (!mediaByPaper.get(rep)?.get(qnum)?.images.length) continue; // 풀 수 있는 것만
    candidates.push({
      paperId: rep,
      questionNumber: qnum,
      wrongCount: v.wrongCount,
      lastWrongAt: v.at,
    });
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

  const [mediaByPaper, marks] = await Promise.all([
    fetchQuestionMedia(supabase, paperIds),
    fetchWrongNoteMarks(supabase, userId, paperIds),
  ]);
  const seen = new Set<string>();
  const items: { paperId: string; questionNumber: number }[] = [];
  for (const r of rows) {
    if (!mediaByPaper.get(r.paper_id)?.get(r.question_number)?.images.length) continue;
    const key = `${r.paper_id}#${r.question_number}`;
    if (marks.deleted.has(key)) continue;
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
// 뽑기는 과목 섞어풀기와 같은 층 정원제를 쓴다 — 전 과목이면 후보가 더 크게 쌓이므로
// 균등 추출의 희석 문제가 더 심해지는 자리다.
export async function createAllReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  opts: { onlyDue?: boolean; includeResolved?: boolean; strategy?: ReviewPickStrategy },
): Promise<{ sessionId?: string; error?: string }> {
  const candidates = await collectAllReviewCandidates(supabase, userId, opts);
  const items = pickReviewCandidates(candidates, MAX_LIMIT, opts.strategy ?? "weighted");
  if (items.length === 0) {
    return {
      error: opts.onlyDue
        ? "지금 복습할 문항이 없어요. 하루 뒤에 다시 확인해보세요."
        : opts.includeResolved
          ? "다시 풀 문항이 없어요."
          : "아직 안 극복한(이미지가 있는) 오답이 없어요.",
    };
  }
  // 이미 층 정원제로 고르고 순서까지 섞은 목록이라 여기서 다시 섞지 않는다.
  return createReviewSessionFromItems(supabase, userId, items, items.length, {
    keepOrder: true,
  });
}

// 넘어온 (문제지, 문항) 목록에서 **이 사용자가 실제로 풀어 본 문항만** 남긴다.
//
// 왜 필요한가: createReviewSessionFromItems 는 목록을 그대로 믿고 service_role 로 세션을
// 만들고, 채점이 끝나면 getReviewSessionView 가 각 문항의 공식 정답(correctChoice)을
// 실어 돌려준다. paper_answers 는 "정답이 그대로 노출되면 채점 의미가 없으므로"
// 관리자 전용 RLS 로 잠가 둔 값인데(schema.sql), 목록이 검증되지 않으면 아무 문제지의
// 1~50번을 넣고 빈 답안으로 제출하는 것만으로 그 잠금이 통째로 풀린다 — 번호만 바꿔
// 반복하면 전 문제지 정답표가 그대로 빠져나간다.
//
// 그래서 "내가 푼 적 있는 문항"으로 좁힌다. 그 문항을 풀려면 CBT 를 실제로 응시해야
// 하고(서버가 시작 시각을 기록하고 최소 응시시간을 강제한다), 그 사람에게 자기가 푼
// 문항의 정답을 보여주는 것은 이 기능의 원래 목적 그대로다.
//
// user_question_status 는 select-own RLS 라 **사용자 세션 클라이언트로** 조회하면
// 스코프가 자동으로 본인 행에 묶인다 — service_role 로 읽고 user_id 를 손으로 맞추는
// 것보다 실수할 여지가 적다.
const FROM_ITEMS_INPUT_MAX = 200;

export async function filterQuestionsAnsweredByUser(
  supabase: Supabase,
  items: { paperId: string; questionNumber: number }[],
): Promise<{ paperId: string; questionNumber: number }[]> {
  // 조회 크기를 먼저 묶는다. 세션은 어차피 MAX_LIMIT 로 잘리고, 실제 결과 화면이
  // 넘기는 건 한 문제지의 오답(많아야 수십 개)이다.
  const clean = items
    .filter(
      (it) =>
        typeof it?.paperId === "string" &&
        it.paperId.length > 0 &&
        Number.isInteger(it?.questionNumber),
    )
    .slice(0, FROM_ITEMS_INPUT_MAX);
  if (clean.length === 0) return [];

  const { data } = await supabase
    .from("user_question_status")
    .select("paper_id, question_number")
    .in("paper_id", [...new Set(clean.map((it) => it.paperId))]);

  const mine = new Set(
    (data ?? []).map((r) => `${r.paper_id as string}#${r.question_number as number}`),
  );
  return clean.filter((it) => mine.has(`${it.paperId}#${it.questionNumber}`));
}

// 채점 결과에서 "틀린 문항만 다시 풀기": 넘겨받은 (문제지, 문항) 목록으로 새 세션을
// 만든다. 정답·이미지는 채점/렌더 시점에 서버가 다시 조회하므로 목록엔 정답이 없다.
//
// keepOrder를 켜면 넘어온 순서를 그대로 쓴다. 복습 큐는 이미 우선순위와 과목
// 섞기까지 계산해서 넘기므로(review-queue.ts), 여기서 다시 섞으면 그 편성이 통째로
// 버려진다.
//
// ⚠ 이 함수는 items 를 **검증하지 않고 그대로 믿는다**(service_role 로 넣는다). 채점 후
// 응답에는 문항별 공식 정답이 실리므로, 클라이언트가 보낸 목록을 여기로 바로 넘기면
// 관리자 전용인 paper_answers 가 통째로 새어 나간다. 사용자 입력에서 온 목록은 반드시
// filterQuestionsAnsweredByUser 를 먼저 통과시킬 것. 서버가 사용자 데이터로 직접 만든
// 목록(복습 큐·과목 오답노트)만 그대로 넘겨도 된다.
export async function createReviewSessionFromItems(
  supabase: Supabase,
  userId: string,
  items: { paperId: string; questionNumber: number }[],
  limit: number = MAX_LIMIT,
  opts: { keepOrder?: boolean; scope?: string } = {},
): Promise<{ sessionId?: string; error?: string }> {
  const seen = new Set<string>();
  const clean: { paperId: string; questionNumber: number }[] = [];
  for (const it of items) {
    if (!it?.paperId || !Number.isInteger(it?.questionNumber)) continue;
    const key = `${it.paperId}#${it.questionNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ paperId: it.paperId, questionNumber: it.questionNumber });
  }
  if (clean.length === 0) return { error: "다시 풀 문항이 없어요." };

  const cap = Math.min(Math.max(1, limit), MAX_LIMIT);
  const picked = (opts.keepOrder ? clean : shuffle(clean)).slice(0, cap);
  const admin = createAdminClient();
  const { data: session, error: sessionError } = await admin
    .from("review_sessions")
    .insert({
      user_id: userId,
      subject_id: null,
      // 'due'는 복습(간격 반복) 세션. 이걸로 "이어서 풀기"가 섞어풀기 세션을
      // 잘못 집어오지 않게 구분한다.
      scope: opts.scope ?? "subject",
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

// 복습(간격 반복) 세션 생성 — 유료 전용. 어떤 문항을 어떤 순서로 낼지는 이미
// review-queue.ts가 정해서 넘기므로 여기서는 섞지 않는다(keepOrder).
//
// 오늘 큐가 비어 있는 건 정상 상태다("오늘은 복습할 게 없다"). 그래서 다른 세션
// 생성과 달리 에러 문구가 실패가 아니라 안내에 가깝다.
export async function createDueReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  items: { paperId: string; questionNumber: number }[],
): Promise<{ sessionId?: string; error?: string }> {
  if (items.length === 0) {
    return { error: "오늘 복습할 문항이 없어요." };
  }
  return createReviewSessionFromItems(supabase, userId, items, items.length, {
    keepOrder: true,
    scope: DUE_SCOPE,
  });
}

// 채점 전에 두고 나온 복습 세션(있으면). 카드가 "이어서 풀기"를 띄우는 근거다.
//
// 답은 기기에 임시 저장되지만(review-solver.tsx), 그 주소로 돌아갈 길이 없으면
// 소용이 없다 — 카드에서 새로 시작하면 다른 세션이 만들어져 저장분이 안 붙는다.
//
// 하루가 지난 것은 무시한다. 그때의 큐는 지금 봐야 할 것과 다르고, 며칠 전 세션을
// 되살리면 이미 다른 경로로 푼 문항이 섞여 나온다.
const RESUME_MAX_AGE_HOURS = 24;

export async function findUnfinishedDueSession(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<{ sessionId: string; total: number } | null> {
  const since = new Date(
    now.getTime() - RESUME_MAX_AGE_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const admin = createAdminClient();
  const { data } = await admin
    .from("review_sessions")
    .select("id, total_questions")
    .eq("user_id", userId)
    .eq("scope", DUE_SCOPE)
    .is("submitted_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { sessionId: data.id as string, total: data.total_questions as number };
}

// "찍었어요" — 맞힌 문항의 스케줄만 되돌린다(점수·극복 판정은 그대로).
//
// 채점 중이 아니라 결과 화면에서 누른다. 풀이 중에 체크박스를 두면 매 문항 판단이
// 하나 늘어 시험처럼 푸는 흐름이 끊기는데, 결과 화면에서는 "정답 · 다음 8일 뒤"를
// 보고 나서 "그건 찍은 건데" 하고 되돌리는 게 자연스럽다.
//
// 그래서 이미 반영된 스케줄을 사후에 고치는 쓰기가 된다. 여러 번 눌러도 결과가 같다
// (상태는 그대로 두고 due만 몇 시간 뒤로 다시 잡는다).
export async function markReviewItemGuessed(
  supabase: Supabase,
  userId: string,
  sessionId: string,
  position: number,
  now: Date = new Date(),
): Promise<{ error?: string }> {
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("review_sessions")
    .select("id, user_id, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) return { error: "세션을 찾을 수 없어요." };
  // 채점 전에는 정답을 모르므로 "찍었다"를 받을 자리가 없다(정답 유출 방지도 겸한다).
  if (session.submitted_at == null) return { error: "채점 후에 표시할 수 있어요." };

  const { data: item } = await admin
    .from("review_session_items")
    .select("id, paper_id, question_number, is_correct")
    .eq("session_id", sessionId)
    .eq("position", position)
    .maybeSingle();
  if (!item) return { error: "문항을 찾을 수 없어요." };
  // 틀린 문항은 이미 재확인으로 잡혀 있다 — 더 당길 것이 없다.
  if (item.is_correct !== true) return {};

  await admin.from("review_session_items").update({ guessed: true }).eq("id", item.id);

  // 스케줄이 없는(대기 풀) 문항은 건드릴 게 없다. 승격될 때 어차피 처음부터 시작한다.
  const { data: status } = await admin
    .from("user_question_status")
    .select("srs_interval_days, srs_ease, srs_reps, srs_lapses, srs_due_at")
    .eq("user_id", userId)
    .eq("paper_id", item.paper_id)
    .eq("question_number", item.question_number)
    .maybeSingle();
  if (!status?.srs_due_at) return {};

  const { dueAt } = srsGuessed(srsStateFromRow(status), now);
  await admin
    .from("user_question_status")
    .update({ srs_due_at: dueAt.toISOString(), updated_at: now.toISOString() })
    .eq("user_id", userId)
    .eq("paper_id", item.paper_id)
    .eq("question_number", item.question_number);

  return {};
}

// 같은 개념(keyword_title)의 기출 문항을 전체 코퍼스에서 모아 후보로 뽑는다. 진단의
// "같은개념 기출 5문제 풀기"용 — 유저 오답이 아니라 기출 전체가 소스다. 개념은 과목에
// 걸쳐 표기가 겹칠 수 있어 subjectSlug로 좁힌다. 이미지 없는(못 푸는)·voided(정답 없음)
// 문항은 제외. question_explanations/paper_answers는 service_role만 읽으므로 admin.
export async function collectConceptReviewCandidates(
  supabase: Supabase,
  concept: string,
  subjectSlug: string | null,
): Promise<{ paperId: string; questionNumber: number }[]> {
  const kw = concept.trim();
  if (!kw) return [];
  const admin = createAdminClient();

  // 1) 같은 keyword_title 해설 → question_id. 코퍼스가 커도 상한을 둔다(랜덤 풀 충분).
  const { data: expl } = await admin
    .from("question_explanations")
    .select("question_id")
    .eq("keyword_title", kw)
    .limit(500);
  const questionIds = [...new Set((expl ?? []).map((r) => r.question_id as string))];
  if (questionIds.length === 0) return [];

  // subjectSlug가 있으면 subject_id로 환원해 그 과목 문항으로만 좁힌다(개념 표기가 과목에
  // 걸쳐 겹칠 수 있음). slug를 못 찾으면 과목 제한 없이 진행.
  let subjectId: string | null = null;
  if (subjectSlug) {
    const { data: subj } = await admin
      .from("subjects")
      .select("id")
      .eq("slug", subjectSlug)
      .maybeSingle();
    subjectId = (subj?.id as string) ?? null;
  }

  // 2) question_id → (paper_id, question_number). 과목 제한이 있으면 임베드 FK로 필터.
  const rows: { paper_id: string; question_number: number }[] = [];
  for (const ids of chunkIds(questionIds, 100)) {
    const q = subjectId
      ? admin
          .from("questions")
          .select("paper_id, question_number, exam_papers!inner(subject_id)")
          .in("id", ids)
          .eq("exam_papers.subject_id", subjectId)
      : admin.from("questions").select("paper_id, question_number").in("id", ids);
    const { data } = await q;
    for (const r of (data ?? []) as { paper_id: string; question_number: number }[]) {
      rows.push({ paper_id: r.paper_id, question_number: r.question_number });
    }
  }
  if (rows.length === 0) return [];

  // 3) 이미지 있는(풀 수 있는) 문항만 + voided 제외.
  const paperIds = [...new Set(rows.map((r) => r.paper_id))];
  const mediaByPaper = await fetchQuestionMedia(supabase, paperIds);

  const voidedByPaper = new Map<string, Set<number>>();
  for (const ids of chunkIds(paperIds, 200)) {
    const { data } = await admin
      .from("paper_answers")
      .select("paper_id, voided_questions")
      .in("paper_id", ids);
    for (const row of (data ?? []) as { paper_id: string; voided_questions: number[] | null }[]) {
      voidedByPaper.set(row.paper_id, new Set((row.voided_questions ?? []) as number[]));
    }
  }

  const seen = new Set<string>();
  const items: { paperId: string; questionNumber: number }[] = [];
  for (const r of rows) {
    if (!mediaByPaper.get(r.paper_id)?.get(r.question_number)?.images.length) continue;
    if (voidedByPaper.get(r.paper_id)?.has(r.question_number)) continue;
    const key = `${r.paper_id}#${r.question_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ paperId: r.paper_id, questionNumber: r.question_number });
  }
  return items;
}

// 같은개념 기출 랜덤 세션(있는 만큼, 최대 limit). 후보가 하나도 없으면 error.
export async function createConceptReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  input: { concept: string; subjectSlug: string | null; limit?: number },
): Promise<{ sessionId?: string; error?: string }> {
  const items = await collectConceptReviewCandidates(supabase, input.concept, input.subjectSlug);
  if (items.length === 0) {
    return { error: "이 개념으로 풀 수 있는 기출 문항을 찾지 못했어요." };
  }
  return createReviewSessionFromItems(supabase, userId, items, input.limit ?? 5);
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
    .select("id, paper_id, question_number, position, selected_choice, is_correct, guessed")
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
      guessed: submitted ? it.guessed === true : false,
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
    .select("id, user_id, submitted_at, created_at")
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
    // 클라이언트가 보내는 값이라 소수·거대한 수가 섞이면 smallint 저장이 통째로
    // 실패하므로, 정상 범위 밖은 "안 푼 문제"로 정제한다.
    const selected = sanitizeSelectedChoice(answers[it.position]);
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
  //
  // 세션 문항의 paper_id 는 dedup 대표 id다. 중복 시험지를 응시한 사용자는 상태·복습
  // 스케줄이 원본 id 쪽에 있으므로, 기록 대상을 실제 행이 있는 문제지로 되짚는다
  // (status-targets.ts). 되짚기가 실패하면 넘어온 id 그대로 — 예전 동작이다.
  let targets = new Map<string, string[]>();
  try {
    targets = await resolveStatusTargets(
      supabase,
      userId,
      gradedRows.map((r) => ({
        paperId: r.paper_id,
        questionNumber: r.question_number,
      })),
    );
  } catch {
    // 무시: 되짚기 실패가 채점을 막지 않는다.
  }

  const byPaper = new Map<string, { question_number: number; is_correct: boolean }[]>();
  for (const r of gradedRows) {
    const paperIds =
      targets.get(statusTargetKey(r.paper_id, r.question_number)) ?? [r.paper_id];
    for (const paperId of paperIds) {
      const list = byPaper.get(paperId) ?? [];
      list.push({ question_number: r.question_number, is_correct: r.is_correct });
      byPaper.set(paperId, list);
    }
  }
  try {
    for (const [paperId, results] of byPaper) {
      await recordQuestionResults(userId, paperId, results, "review");
    }
  } catch {
    // 무시: 상태 갱신 실패가 채점을 막지 않는다.
  }

  // 출석 도장. byPaper 가 아니라 gradedRows 로 센다 — 중복 시험지는 한 문항이 여러
  // paper_id 로 되짚어져(byPaper) 같은 문항이 두 번 들어 있다. 그걸로 세면 실제로 푼
  // 것보다 많은 문항을 푼 셈이 되어 출석 기준이 헐거워진다.
  //
  // 세는 것은 "채점된 문항"이 아니라 **답을 고른 문항**이고, 세션이 너무 빨리 끝났으면
  // 아예 세지 않는다(attendanceQuestionCount). CBT 와 달리 이 경로에는 최소 응시시간이
  // 없어서, 세션을 만들자마자 빈 답안으로 제출하는 것만으로 도장이 찍혔다 — 그 도장은
  // 멤버십 일수로 환전된다. 경과 시간은 반드시 서버가 기록한 created_at 으로 잰다.
  try {
    const elapsedSeconds =
      (Date.now() - new Date(session.created_at as string).getTime()) / 1000;
    await recordAttendance(
      userId,
      attendanceQuestionCount({
        answeredCount: gradedRows.filter((r) => r.selected_choice !== null).length,
        elapsedSeconds,
      }),
    );
  } catch {
    // 무시: 출석 기록 실패가 채점을 막지 않는다.
  }

  const view = await getReviewSessionView(supabase, userId, sessionId);
  return { view: view ?? undefined };
}
