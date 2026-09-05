import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllPages } from "@/lib/fetch-paged";
import {
  collidingPaperIds,
  fetchPaperIdentitySignals,
  representativePaperIds,
} from "@/lib/dedup-papers";
import {
  fetchCorrectAnswers,
  fetchExplainedNumbers,
  fetchExplanations,
  fetchMemos,
  fetchQuestionMedia,
  fetchWrongNoteMarks,
  getSubjectBySlug,
} from "@/lib/wrong-notes";
import { createReviewSessionFromItems } from "@/lib/review-session";
import type { QuestionExplanationContent } from "@/components/explanation-body";
import {
  clampMixLimit,
  filterMixCandidatesByLevel,
  getPaperDisplayTitle,
  applyExamTypeSubjectName,
  kstDayKey,
  labelMixSessions,
  mixCandidateKey,
  pickMixQuestions,
  MIX_MAX_LIMIT,
  MIX_NO_LEVEL,
  type MixCandidate,
  type Subject,
} from "@gongmoa/core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 기출 섞어풀기 — 한 과목의 기출 전체(시행처 무관)에서 무작위로 뽑아 새 문제를 푼다.
//
// 오답 섞어풀기(review-session.ts)와 같은 테이블(review_sessions/items, scope='mix')과
// 같은 풀이·채점 경로를 쓴다. 다른 것은 **후보가 어디서 오는가**뿐이다 — 저쪽은 내
// 오답, 여기는 과목의 기출 코퍼스. 채점 결과는 똑같이 user_question_status 에 기록되므로
// 여기서 틀린 문항은 오답노트(문항 모아보기·복습 큐)에 그대로 합류하고, 세션 자체는
// 오답노트 과목 페이지에 "9월 5일 섞어풀기" 카드로 남는다.

export const MIX_SCOPE = "mix";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type PoolPaper = {
  id: string;
  subject_id: string;
  exam_type_id: string;
  year: number;
  round: number;
  level: string | null;
  track: string | null;
  title: string;
  created_at: string;
  exam_types: { name: string } | null;
};

export type MixPool = {
  // 출제 가능한 (대표 문제지, 문항). 이미지가 있고, 정답이 등록돼 있고, voided 가 아닌 것.
  // level·conceptId 는 급수 필터와 개념 분산(pickMixQuestions)의 재료다.
  candidates: MixCandidate[];
  // 화면 안내용 통계. paperCount 는 중복 시험지를 합친 뒤의 수(과목 페이지와 같다).
  paperCount: number;
  examTypeNames: string[];
  // 급수별 출제 가능 문항 수. 급수 없는 문제지는 MIX_NO_LEVEL 키. 시작 화면 급수 칩용.
  levelCounts: Record<string, number>;
  minYear: number | null;
  maxYear: number | null;
  // 실제 paper_id → 대표 paper_id. 사용자의 풀이 기록(실제 id 기준)을 후보 키(대표 id)에
  // 맞추는 데 쓴다. 'use cache' 가 결과를 직렬화하므로 Map 대신 객체.
  repByPaperId: Record<string, string>;
};

// 문항 id → 정본 개념 id. question_explanations 는 service_role 만 읽는다(정답 요약이
// 실려 있어서). 여기서는 concept_id 만 받고 본문은 건드리지 않는다.
async function fetchCanonicalConcepts(
  admin: ReturnType<typeof createAdminClient>,
  questionIds: string[],
): Promise<Map<string, string>> {
  const raw = new Map<string, string>();
  for (const ids of chunk(questionIds, 200)) {
    const { data } = await admin
      .from("question_explanations")
      .select("question_id, concept_id")
      .in("question_id", ids)
      .not("concept_id", "is", null);
    for (const r of (data ?? []) as { question_id: string; concept_id: string | null }[]) {
      if (r.concept_id) raw.set(r.question_id, r.concept_id);
    }
  }
  if (raw.size === 0) return raw;

  // merged_into 를 끝까지 따라간다(보통 한 단계). 순환은 방어적으로 끊는다.
  const mergedInto = new Map<string, string | null>();
  for (const ids of chunk([...new Set(raw.values())], 200)) {
    const { data } = await admin.from("concepts").select("id, merged_into").in("id", ids);
    for (const r of (data ?? []) as { id: string; merged_into: string | null }[]) {
      mergedInto.set(r.id, r.merged_into);
    }
  }
  const canonical = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 5; i++) {
      const next = mergedInto.get(cur);
      if (!next || next === cur) break;
      cur = next;
    }
    return cur;
  };
  const out = new Map<string, string>();
  for (const [qid, cid] of raw) out.set(qid, canonical(cid));
  return out;
}

// 과목 하나의 출제 풀. 문제지 수백 장 × 문항 수십 개를 훑는 조회라 요청마다 돌리지
// 않고 캐시한다 — 로그인 여부와 무관한 공개 자료(문항 이미지 존재 여부·정답 등록
// 여부)만 담고 정답 자체는 싣지 않는다. 새 문제지·정답이 올라오면 홈 데이터와 같은
// 태그로 함께 갱신되고, 그 전에도 한 시간이면 저절로 새로 만든다.
export async function getMixPool(subjectId: string): Promise<MixPool> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const papers = await fetchAllPages<PoolPaper>(
    (from, to) =>
      supabase
        .from("exam_papers")
        .select(
          "id, subject_id, exam_type_id, year, round, level, track, title, created_at, exam_types(name)",
        )
        .eq("subject_id", subjectId)
        .order("id", { ascending: true })
        .range(from, to) as unknown as Promise<{
        data: PoolPaper[] | null;
        error: { message: string } | null;
      }>,
    "섞어풀기 문제지",
  );
  const empty: MixPool = {
    candidates: [],
    paperCount: 0,
    examTypeNames: [],
    levelCounts: {},
    minYear: null,
    maxYear: null,
    repByPaperId: {},
  };
  if (papers.length === 0) return empty;

  // 직류만 다른 같은 시험지는 하나로 접는다 — 안 접으면 같은 문항이 두 장에서 한 번씩
  // 뽑혀 한 세션에 두 번 나올 수 있다.
  const signals = await fetchPaperIdentitySignals(supabase, collidingPaperIds(papers));
  const { repByPaperId } = representativePaperIds(papers, signals);
  const repIds = [...new Set(papers.map((p) => repByPaperId.get(p.id) ?? p.id))];

  // 정답이 등록된 문제지만 채점할 수 있다. voided(전항정답·복수정답) 문항은 정답이
  // 없어 "맞다/틀리다"를 말할 수 없으므로 후보에서 뺀다(schema.sql 의 의도 그대로).
  const admin = createAdminClient();
  const voidedByPaper = new Map<string, Set<number>>();
  for (const ids of chunk(repIds, 200)) {
    const { data } = await admin
      .from("paper_answers")
      .select("paper_id, voided_questions")
      .in("paper_id", ids);
    for (const row of (data ?? []) as { paper_id: string; voided_questions: number[] | null }[]) {
      voidedByPaper.set(row.paper_id, new Set(row.voided_questions ?? []));
    }
  }
  const answeredRepIds = repIds.filter((id) => voidedByPaper.has(id));
  if (answeredRepIds.length === 0) return { ...empty, paperCount: repIds.length };

  // 이미지가 잘려 있는 문항만(문제를 보여줄 수 없으면 못 푼다). question_images 를
  // inner 조인해 이미지가 하나라도 있는 문항만 받는다 — 이미지 경로 자체는 세션을
  // 그릴 때 fetchQuestionMedia 가 뽑힌 문항에 대해서만 다시 받는다.
  const levelByPaper = new Map(papers.map((p) => [p.id, p.level ?? null]));
  type QRow = { id: string; paper_id: string; question_number: number };
  const rowsById = new Map<string, QRow>();
  for (const ids of chunk(answeredRepIds, 25)) {
    const rows = await fetchAllPages<QRow>(
      (from, to) =>
        supabase
          .from("questions")
          .select("id, paper_id, question_number, question_images!inner(order_index)")
          .in("paper_id", ids)
          .order("paper_id", { ascending: true })
          .order("question_number", { ascending: true })
          .range(from, to) as unknown as Promise<{
          data: QRow[] | null;
          error: { message: string } | null;
        }>,
      "섞어풀기 문항",
    );
    for (const r of rows) {
      if (voidedByPaper.get(r.paper_id)?.has(r.question_number)) continue;
      rowsById.set(r.id, r);
    }
  }

  // 문항별 정본 개념. 해설 배치가 붙인 concept_id 를 읽고, 합쳐진 개념(merged_into)은
  // 합쳐진 쪽으로 되짚는다 — 같은 개념이 옛 id 와 새 id 로 갈라져 있으면 분산이 안 된다.
  // 해설이 없는 문항은 null 로 남는다(개념 분산에서 상한을 받지 않는다).
  const conceptByQuestionId = await fetchCanonicalConcepts(admin, [...rowsById.keys()]);

  const candidates: MixCandidate[] = [];
  const seen = new Set<string>();
  const levelCounts: Record<string, number> = {};
  for (const r of rowsById.values()) {
    const c: MixCandidate = {
      paperId: r.paper_id,
      questionNumber: r.question_number,
      level: levelByPaper.get(r.paper_id) ?? null,
      conceptId: conceptByQuestionId.get(r.id) ?? null,
    };
    const key = mixCandidateKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(c);
    const lk = c.level ?? MIX_NO_LEVEL;
    levelCounts[lk] = (levelCounts[lk] ?? 0) + 1;
  }

  const examTypeNames = [
    ...new Set(papers.map((p) => p.exam_types?.name).filter((n): n is string => !!n)),
  ];
  const years = papers.map((p) => p.year);

  return {
    candidates,
    paperCount: repIds.length,
    examTypeNames,
    levelCounts,
    minYear: years.length ? Math.min(...years) : null,
    maxYear: years.length ? Math.max(...years) : null,
    repByPaperId: Object.fromEntries(repByPaperId),
  };
}

export type MixOverview = {
  subject: Subject;
  questionCount: number;
  paperCount: number;
  examTypeNames: string[];
  // 급수별 출제 가능 문항 수(급수 없음은 MIX_NO_LEVEL 키).
  levelCounts: Record<string, number>;
  minYear: number | null;
  maxYear: number | null;
};

// 시작 화면용 요약. 로그인과 무관한 공개 통계라 사용자 클라이언트가 필요 없고,
// generateMetadata 와 본문이 같은 요청에서 두 번 부르므로 통째로 캐시한다.
export async function getMixOverview(slug: string): Promise<MixOverview | null> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const subject = await getSubjectBySlug(createPublicClient(), slug);
  if (!subject) return null;
  const pool = await getMixPool(subject.id);
  return {
    subject,
    questionCount: pool.candidates.length,
    paperCount: pool.paperCount,
    examTypeNames: pool.examTypeNames,
    levelCounts: pool.levelCounts,
    minYear: pool.minYear,
    maxYear: pool.maxYear,
  };
}

// 이 사용자가 어디서든(CBT·복습·섞어풀기) 한 번이라도 채점받은 문항을 대표 id 키로
// 모은다. user_question_status 는 select-own RLS 라 사용자 클라이언트로 읽으면 본인
// 행만 온다. 회독이 쌓인 계정은 수천 행이 될 수 있어 1000 씩 이어받는다.
async function fetchSeenKeys(
  supabase: Supabase,
  userId: string,
  repByPaperId: Record<string, string>,
): Promise<Set<string>> {
  const out = new Set<string>();
  const SIZE = 1000;
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from("user_question_status")
      .select("paper_id, question_number")
      .eq("user_id", userId)
      .range(from, from + SIZE - 1);
    if (!data || data.length === 0) break;
    for (const r of data as { paper_id: string; question_number: number }[]) {
      const rep = repByPaperId[r.paper_id] ?? r.paper_id;
      out.add(`${rep}#${r.question_number}`);
    }
    if (data.length < SIZE) break;
    from += SIZE;
  }
  return out;
}

export type CreateMixSessionResult = {
  sessionId?: string;
  error?: string;
  // 뽑힌 문항 중 처음 보는 문항 수. 전부 새 문항이면 total 과 같다.
  unseenCount?: number;
  // 새 문항만으로 정원을 못 채워 푼 문항이 섞였다(= 이 과목 기출을 한 바퀴 돌았다).
  coveredAll?: boolean;
};

// 기출 섞어풀기 세션 생성. 세션·문항 저장은 오답 섞어풀기와 같은 함수를 쓴다 —
// 뽑은 순서(문제지 라운드로빈 + 섞기)를 그대로 쓰므로 keepOrder.
export async function createMixSessionForUser(
  supabase: Supabase,
  userId: string,
  // levels: 급수 필터(빈 배열 = 전체). 풀에 실제로 있는 급수 키만 받아들인다.
  input: { subjectSlug: string; limit?: number; levels?: string[] },
): Promise<CreateMixSessionResult> {
  const subject = await getSubjectBySlug(supabase, input.subjectSlug);
  if (!subject) return { error: "과목을 찾을 수 없어요." };

  const pool = await getMixPool(subject.id);
  if (pool.candidates.length === 0) {
    return {
      error:
        "이 과목은 아직 섞어풀기를 준비 중이에요. 문항 이미지와 정답이 등록된 문제지가 생기면 열려요.",
    };
  }

  const levels = (input.levels ?? []).filter((l) => l in pool.levelCounts);
  const candidates = filterMixCandidatesByLevel(pool.candidates, levels);
  if (candidates.length === 0) {
    return { error: "고른 급수에는 아직 풀 수 있는 문항이 없어요. 급수를 바꿔보세요." };
  }

  const limit = clampMixLimit(input.limit);
  const seen = await fetchSeenKeys(supabase, userId, pool.repByPaperId);
  const { picked, unseenCount, coveredAll } = pickMixQuestions(candidates, limit, seen);
  if (picked.length === 0) return { error: "출제할 문항이 없어요." };

  const res = await createReviewSessionFromItems(supabase, userId, picked, picked.length, {
    keepOrder: true,
    scope: MIX_SCOPE,
    subjectId: subject.id,
    maxLimit: MIX_MAX_LIMIT,
  });
  if (res.error || !res.sessionId) return { error: res.error ?? "세션 생성에 실패했어요." };
  return { sessionId: res.sessionId, unseenCount, coveredAll };
}

// ── 오답노트 기록 ─────────────────────────────────────────────────────────────

export type MixSessionSummary = {
  id: string;
  title: string;
  createdAt: string;
  score: number;
  total: number;
  // 이 세션에서 틀린 문항 수와 그중 지금은 극복한(가장 최근 채점에서 맞힌) 수.
  wrongCount: number;
  resolvedCount: number;
};

type SessionRow = { id: string; created_at: string; score: number | null; total_questions: number };

async function fetchSubmittedMixSessions(
  userId: string,
  subjectId: string,
): Promise<SessionRow[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("review_sessions")
    .select("id, created_at, score, total_questions")
    .eq("user_id", userId)
    .eq("subject_id", subjectId)
    .eq("scope", MIX_SCOPE)
    .not("submitted_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  return (data ?? []) as SessionRow[];
}

// 극복 여부는 user_question_status(모든 채점 경로 통합)의 가장 최근 결과로 본다.
// 세션 문항은 dedup 대표 id 로 저장돼 있고 상태 행은 실제 응시 id 에 있을 수 있어,
// 대표로 접힌 형제 문제지의 행도 함께 본다(status-targets.ts 와 같은 문제).
async function fetchResolvedKeys(
  supabase: Supabase,
  userId: string,
  items: { paperId: string; questionNumber: number }[],
  repByPaperId: Record<string, string>,
): Promise<{ resolved: Set<string>; wrongCount: Map<string, number> }> {
  const resolved = new Set<string>();
  const wrongCount = new Map<string, number>();
  if (items.length === 0) return { resolved, wrongCount };
  const wantedReps = new Set(items.map((it) => it.paperId));
  const realIds = new Set<string>(wantedReps);
  for (const [real, rep] of Object.entries(repByPaperId)) {
    if (wantedReps.has(rep)) realIds.add(real);
  }
  const latest = new Map<string, { correct: boolean; at: string }>();
  for (const ids of chunk([...realIds], 200)) {
    const { data } = await supabase
      .from("user_question_status")
      .select("paper_id, question_number, last_is_correct, last_answered_at, wrong_count")
      .eq("user_id", userId)
      .in("paper_id", ids);
    for (const r of (data ?? []) as {
      paper_id: string;
      question_number: number;
      last_is_correct: boolean;
      last_answered_at: string;
      wrong_count: number | null;
    }[]) {
      const key = `${repByPaperId[r.paper_id] ?? r.paper_id}#${r.question_number}`;
      wrongCount.set(key, Math.max(wrongCount.get(key) ?? 0, r.wrong_count ?? 0));
      const ex = latest.get(key);
      if (!ex || r.last_answered_at > ex.at) {
        latest.set(key, { correct: r.last_is_correct, at: r.last_answered_at });
      }
    }
  }
  for (const [key, v] of latest) if (v.correct) resolved.add(key);
  return { resolved, wrongCount };
}

// 과목 오답노트 "문제지별" 탭에 붙는 섞어풀기 기록 카드 목록(최신순).
export async function listMixSessions(
  supabase: Supabase,
  userId: string,
  subjectId: string,
): Promise<MixSessionSummary[]> {
  const sessions = await fetchSubmittedMixSessions(userId, subjectId);
  if (sessions.length === 0) return [];

  const admin = createAdminClient();
  type ItemRow = { session_id: string; paper_id: string; question_number: number };
  const wrongBySession = new Map<string, ItemRow[]>();
  for (const ids of chunk(sessions.map((s) => s.id), 50)) {
    const { data } = await admin
      .from("review_session_items")
      .select("session_id, paper_id, question_number")
      .in("session_id", ids)
      .eq("is_correct", false);
    for (const r of (data ?? []) as ItemRow[]) {
      const list = wrongBySession.get(r.session_id) ?? [];
      list.push(r);
      wrongBySession.set(r.session_id, list);
    }
  }

  const pool = await getMixPool(subjectId);
  const allWrong = [...wrongBySession.values()].flat();
  const { resolved } = await fetchResolvedKeys(
    supabase,
    userId,
    allWrong.map((r) => ({ paperId: r.paper_id, questionNumber: r.question_number })),
    pool.repByPaperId,
  );

  const titles = labelMixSessions(
    sessions.map((s) => ({ id: s.id, createdAt: s.created_at })),
    kstDayKey,
  );

  return sessions.map((s) => {
    const wrong = wrongBySession.get(s.id) ?? [];
    const resolvedCount = wrong.filter((r) =>
      resolved.has(`${r.paper_id}#${r.question_number}`),
    ).length;
    return {
      id: s.id,
      title: titles.get(s.id) ?? "섞어풀기",
      createdAt: s.created_at,
      score: s.score ?? 0,
      total: s.total_questions,
      wrongCount: wrong.length,
      resolvedCount,
    };
  });
}

export type MixSessionQuestion = {
  position: number;
  paperId: string;
  paperTitle: string;
  paperLevel: string | null;
  examTypeName: string | null;
  questionNumber: number;
  selectedChoice: number | null;
  correctChoice: number | null;
  isCorrect: boolean;
  choiceCount: number;
  images: string[];
  explanation: QuestionExplanationContent | null;
  explanationLocked: boolean;
  memo: string | null;
  pinned: boolean;
  // 통합 상태 기준(모든 채점 경로). 이 세션에서 틀렸어도 그 뒤 다른 곳에서 맞혔으면 극복.
  wrongCount: number;
  resolved: boolean;
};

export type MixSessionWrongNote = {
  session: { id: string; title: string; createdAt: string; score: number; total: number };
  subject: Subject;
  questions: MixSessionQuestion[];
  wrongCount: number;
  resolvedCount: number;
};

// "9월 5일 섞어풀기" 기록 페이지. 본인 세션이 아니거나, 기출 섞어풀기가 아니거나,
// 아직 채점 전이면 null(채점 전 세션의 정답·출처는 절대 내보내지 않는다).
export async function getMixSessionWrongNote(
  supabase: Supabase,
  userId: string,
  sessionId: string,
  includeExplanations = true,
): Promise<MixSessionWrongNote | null> {
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("review_sessions")
    .select("id, user_id, subject_id, scope, score, total_questions, created_at, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (
    !session ||
    session.user_id !== userId ||
    session.scope !== MIX_SCOPE ||
    session.submitted_at == null ||
    !session.subject_id
  ) {
    return null;
  }

  const { data: subjectRow } = await supabase
    .from("subjects")
    .select("*")
    .eq("id", session.subject_id)
    .maybeSingle();
  if (!subjectRow) return null;
  const subject = subjectRow as Subject;

  type ItemRow = {
    paper_id: string;
    question_number: number;
    position: number;
    selected_choice: number | null;
    is_correct: boolean | null;
  };
  const { data: itemRows } = await admin
    .from("review_session_items")
    .select("paper_id, question_number, position, selected_choice, is_correct")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  const items = (itemRows ?? []) as ItemRow[];

  const paperIds = [...new Set(items.map((i) => i.paper_id))];
  const wanted = new Map<string, Set<number>>();
  for (const it of items) {
    const set = wanted.get(it.paper_id) ?? new Set<number>();
    set.add(it.question_number);
    wanted.set(it.paper_id, set);
  }

  type PaperRow = {
    id: string;
    title: string;
    level: string | null;
    track: string | null;
    choice_count: number;
    exam_types: { name: string } | null;
  };
  const [
    { data: paperRows },
    mediaByPaper,
    answersByPaper,
    explanationsByPaper,
    explainedByPaper,
    memoByKey,
    marks,
    pool,
    allSessions,
  ] = await Promise.all([
    paperIds.length > 0
      ? supabase
          .from("exam_papers")
          .select("id, title, level, track, choice_count, exam_types(name)")
          .in("id", paperIds)
      : Promise.resolve({ data: [] as PaperRow[] }),
    fetchQuestionMedia(supabase, paperIds, wanted),
    fetchCorrectAnswers(paperIds),
    includeExplanations
      ? fetchExplanations(paperIds, wanted)
      : Promise.resolve(new Map<string, Map<number, QuestionExplanationContent>>()),
    includeExplanations
      ? Promise.resolve(new Map<string, Set<number>>())
      : fetchExplainedNumbers(paperIds, wanted),
    fetchMemos(supabase, userId, paperIds),
    fetchWrongNoteMarks(supabase, userId, paperIds),
    getMixPool(session.subject_id as string),
    fetchSubmittedMixSessions(userId, session.subject_id as string),
  ]);
  const paperById = new Map(
    ((paperRows ?? []) as unknown as PaperRow[]).map((p) => [p.id, p]),
  );
  const { resolved, wrongCount } = await fetchResolvedKeys(
    supabase,
    userId,
    items.map((it) => ({ paperId: it.paper_id, questionNumber: it.question_number })),
    pool.repByPaperId,
  );

  const questions: MixSessionQuestion[] = items.map((it) => {
    const key = `${it.paper_id}#${it.question_number}`;
    const paper = paperById.get(it.paper_id);
    const media = mediaByPaper.get(it.paper_id)?.get(it.question_number);
    return {
      position: it.position,
      paperId: it.paper_id,
      paperTitle: paper
        ? applyExamTypeSubjectName(getPaperDisplayTitle(paper.title, paper.track))
        : "삭제된 문제지",
      paperLevel: paper?.level ?? null,
      examTypeName: paper?.exam_types?.name ?? null,
      questionNumber: it.question_number,
      selectedChoice: it.selected_choice,
      correctChoice: answersByPaper.get(it.paper_id)?.[it.question_number - 1] ?? null,
      isCorrect: it.is_correct === true,
      choiceCount: media?.choiceCount ?? paper?.choice_count ?? 4,
      images: media?.images ?? [],
      explanation: explanationsByPaper.get(it.paper_id)?.get(it.question_number) ?? null,
      explanationLocked: explainedByPaper.get(it.paper_id)?.has(it.question_number) ?? false,
      memo: memoByKey.get(key) ?? null,
      pinned: marks.pinned.has(key),
      wrongCount: wrongCount.get(key) ?? (it.is_correct === false ? 1 : 0),
      resolved: resolved.has(key),
    };
  });

  const titles = labelMixSessions(
    allSessions.map((s) => ({ id: s.id, createdAt: s.created_at })),
    kstDayKey,
  );
  const wrong = questions.filter((q) => !q.isCorrect);

  return {
    session: {
      id: session.id as string,
      title: titles.get(session.id as string) ?? "섞어풀기",
      createdAt: session.created_at as string,
      score: (session.score as number | null) ?? 0,
      total: session.total_questions as number,
    },
    subject,
    questions,
    wrongCount: wrong.length,
    resolvedCount: wrong.filter((q) => q.resolved).length,
  };
}

// 기록 페이지·결과 화면의 "틀린 N문항 다시 풀기". 세션 소유자 확인을 서버가 하므로
// 클라이언트가 문항 목록을 보낼 필요가 없다(정답 유출 경로가 생기지 않는다).
export async function createRetryFromMixSession(
  supabase: Supabase,
  userId: string,
  sessionId: string,
): Promise<{ sessionId?: string; error?: string }> {
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("review_sessions")
    .select("id, user_id, subject_id, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId) return { error: "세션을 찾을 수 없어요." };
  if (session.submitted_at == null) return { error: "채점 후에 다시 풀 수 있어요." };

  const { data: rows } = await admin
    .from("review_session_items")
    .select("paper_id, question_number, position")
    .eq("session_id", sessionId)
    .eq("is_correct", false)
    .order("position", { ascending: true });
  const items = ((rows ?? []) as { paper_id: string; question_number: number }[]).map((r) => ({
    paperId: r.paper_id,
    questionNumber: r.question_number,
  }));
  if (items.length === 0) return { error: "다시 풀 틀린 문항이 없어요." };

  return createReviewSessionFromItems(supabase, userId, items, items.length, {
    subjectId: (session.subject_id as string | null) ?? null,
    maxLimit: MIX_MAX_LIMIT,
  });
}
