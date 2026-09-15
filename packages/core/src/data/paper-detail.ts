import type { SupabaseClient } from "@supabase/supabase-js";
import { collapseDuplicatePapers, paperDedupKey } from "../dedup-papers";
import type { AnswerKey, Comment, ExamPaper } from "../types";
import { othersRoundAveragePct } from "../wrong-notes";
import { fetchSubjectFilters, type ExamTypeOption, type SignalsProvider } from "./papers";

// 문제지 상세 조회 — 웹 app/papers/[id]/paper-detail-data.ts 를 DI 로 옮긴 것.
// 웹은 한 번에 받지만 앱은 "공개 데이터"(누구나·퍼시스트)와 "내 데이터"(RLS 본인·30초)로
// 갈라 쿼리 키를 따로 둔다(설계서 §6.3 등급).

export async function fetchPaperById(client: SupabaseClient, id: string): Promise<ExamPaper | null> {
  const { data } = await client
    .from("exam_papers")
    .select("*, subjects(*), exam_types(*)")
    .eq("id", id)
    .maybeSingle();
  return (data as ExamPaper | null) ?? null;
}

export type RoundAverage = { round: number; avgPct: number; attemptCount: number };

export type PaperPublicDetail = {
  comments: Comment[];
  averageScore: number | null;
  voteCount: number;
  hasCbtAnswers: boolean;
  // 표본 3명 미만 회차는 DB 함수(avg_score_by_round)가 이미 제외한다.
  roundAverages: RoundAverage[];
  answerKey: AnswerKey | null;
  // 전 문항 해설이 준비된 문제지에만 "해설 열기"(반쪽 해설집을 "지원"으로 표시하지 않는다).
  // paper_explanation_counts 는 anon 에도 열려 있어(schema.sql Phase 0) 게스트도 본다 — 웹이
  // service_role 로 누구에게나 세어 주는 것과 같다.
  hasFullExplanations: boolean;
};

// 로그인 여부와 무관한 부분(댓글·난이도 집계·정답표·CBT 지원·회독 평균·해설 유무).
export async function fetchPaperPublicDetail(
  client: SupabaseClient,
  paper: ExamPaper,
): Promise<PaperPublicDetail> {
  // 정답표는 (시험종류+연도+급수+회차)당 1장이 원칙이고 track은 대개 null이다 — track 조건
  // 없이 다 받아 exact track 정답표를 우선하고, 없으면 공용(track null) 정답표로 폴백한다
  // (apps/web/docs/agents/answer-keys-tracks.md).
  let answerKeyQuery = client
    .from("answer_keys")
    .select("*")
    .eq("exam_type_id", paper.exam_type_id)
    .eq("year", paper.year)
    .eq("round", paper.round);
  answerKeyQuery = paper.level ? answerKeyQuery.eq("level", paper.level) : answerKeyQuery.is("level", null);

  const [
    { data: comments },
    { data: ratings },
    { data: answerKeyRows },
    { data: hasCbtAnswers },
    { data: roundRows },
    { data: countRows },
  ] = await Promise.all([
      client
        .from("comments")
        .select("id, paper_id, user_id, nickname, content, created_at, updated_at, parent_id")
        .eq("paper_id", paper.id)
        .order("created_at", { ascending: true }),
      client.from("difficulty_ratings").select("score").eq("paper_id", paper.id),
      answerKeyQuery,
      client.rpc("has_cbt_answers", { target_paper_id: paper.id }),
      client.rpc("avg_score_by_round", { target_paper_id: paper.id }),
      client.rpc("paper_explanation_counts", { p_paper_ids: [paper.id] }),
    ]);

  const explanationCount =
    ((countRows ?? []) as { paper_id: string; count: number }[]).find((r) => r.paper_id === paper.id)?.count ?? 0;

  const scores = ((ratings ?? []) as { score: number }[]).map((r) => Number(r.score));
  const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const answerKeys = (answerKeyRows ?? []) as AnswerKey[];
  const answerKey =
    answerKeys.find((k) => k.track != null && k.track === paper.track) ??
    answerKeys.find((k) => k.track == null) ??
    null;

  const roundAverages: RoundAverage[] = (
    (roundRows ?? []) as { round: number; avg_pct: number; attempt_count: number }[]
  ).map((r) => ({ round: r.round, avgPct: Number(r.avg_pct), attemptCount: Number(r.attempt_count) }));

  return {
    comments: (comments ?? []) as Comment[],
    averageScore,
    voteCount: scores.length,
    hasCbtAnswers: hasCbtAnswers === true,
    roundAverages,
    answerKey,
    hasFullExplanations: !!paper.question_count && explanationCount >= paper.question_count,
  };
}

export type MyCbtRecordItem = {
  id: string;
  round: number;
  score: number;
  totalQuestions: number;
  createdAt: string;
  durationSeconds: number | null;
};

export type PaperMyDetail = {
  isBookmarked: boolean;
  myScore: number | null;
  // 오래된 순(1회독부터).
  myCbtRecordItems: MyCbtRecordItem[];
};

// 본인 RLS 데이터(즐겨찾기·내 난이도·내 응시). 해설 유무는 공개 쪽(fetchPaperPublicDetail).
export async function fetchPaperMyDetail(
  client: SupabaseClient,
  paper: ExamPaper,
  userId: string,
): Promise<PaperMyDetail> {
  const [{ data: bookmarkData }, { data: myRatingData }, { data: attemptRows }] =
    await Promise.all([
      client.from("bookmarks").select("id").eq("user_id", userId).eq("paper_id", paper.id).maybeSingle(),
      client
        .from("difficulty_ratings")
        .select("score")
        .eq("paper_id", paper.id)
        .eq("user_id", userId)
        .maybeSingle(),
      client
        .from("cbt_attempts")
        .select("id, score, total_questions, duration_seconds, created_at")
        .eq("paper_id", paper.id)
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
    ]);

  const attempts = (attemptRows ?? []) as {
    id: string;
    score: number;
    total_questions: number;
    duration_seconds: number | null;
    created_at: string;
  }[];
  return {
    isBookmarked: !!bookmarkData,
    myScore: myRatingData ? Number((myRatingData as { score: number }).score) : null,
    myCbtRecordItems: attempts.map((a, i) => ({
      id: a.id,
      round: i + 1,
      score: a.score,
      totalQuestions: a.total_questions,
      durationSeconds: a.duration_seconds,
      createdAt: a.created_at,
    })),
  };
}

// ── 체감 난이도 투표 (웹 app/papers/actions.ts postRating) ───────────────────

export const DIFFICULTY_SCORES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export async function postDifficultyRating(
  client: SupabaseClient,
  userId: string,
  paperId: string,
  score: number,
): Promise<{ averageScore: number | null; voteCount: number }> {
  if (!DIFFICULTY_SCORES.includes(score)) throw new Error("잘못된 점수입니다.");
  const { error } = await client
    .from("difficulty_ratings")
    .insert({ paper_id: paperId, user_id: userId, guest_token: null, score });
  if (error) throw new Error(error.code === "23505" ? "이미 평가했어요." : "평가에 실패했어요.");

  const { data: ratings } = await client.from("difficulty_ratings").select("score").eq("paper_id", paperId);
  const scores = ((ratings ?? []) as { score: number }[]).map((r) => Number(r.score));
  return {
    averageScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    voteCount: scores.length,
  };
}

// ── 하단 "같은 과목 기출문제 목록" (웹 getRelatedPapersData) ──────────────────

export const RELATED_PAPERS_LIMIT = 12;
// 중복을 합치면 개수가 줄기 때문에 12개를 채우려면 합치기 전에 넉넉히 받아둔다.
const RELATED_FETCH_LIMIT = RELATED_PAPERS_LIMIT * 5;

export type RelatedPapers = {
  papers: ExamPaper[];
  availableLevels: string[];
  availableExamTypes: ExamTypeOption[];
};

export async function fetchRelatedPapers(
  client: SupabaseClient,
  paper: ExamPaper,
  filter: { level?: string; examTypeIds?: string[] },
  signalsProvider: SignalsProvider,
): Promise<RelatedPapers | null> {
  if (!paper.subject_id) return null;

  let q = client.from("exam_papers").select("*, subjects(*), exam_types(*)").eq("subject_id", paper.subject_id);
  if (filter.level) q = q.eq("level", filter.level);
  if (filter.examTypeIds && filter.examTypeIds.length > 0) q = q.in("exam_type_id", filter.examTypeIds);

  const [{ data: rows }, filters] = await Promise.all([
    q.order("year", { ascending: false }).order("round", { ascending: false }).limit(RELATED_FETCH_LIMIT),
    fetchSubjectFilters(client, paper.subject_id),
  ]);

  const raw = ((rows ?? []) as ExamPaper[]);
  const deduped = collapseDuplicatePapers(raw, await signalsProvider(client, raw));
  // 지금 보고 있는 문제지가 중복으로 합쳐져 목록에서 빠졌다면, 그 그룹 대표 자리에
  // 현재 문제지를 대신 넣어 "현재 보는 중" 카드가 그대로 보이게 한다.
  if (!deduped.some((p) => p.id === paper.id)) {
    const currentKey = paperDedupKey(paper);
    const idx = deduped.findIndex((p) => paperDedupKey(p) === currentKey);
    if (idx !== -1) deduped[idx] = paper;
  }
  return {
    papers: deduped.slice(0, RELATED_PAPERS_LIMIT),
    availableLevels: filters.levels,
    availableExamTypes: filters.examTypes,
  };
}

// ── 회독별 나 vs 다른 회원 평균 (웹 lib/wrong-notes.ts getPaperRoundComparisons) ──

export type PaperRoundComparison = {
  round: number;
  myPct: number;
  // 나를 뺀 다른 회원 평균(%). 표본이 모자란 회독은 null(화면에서 비교를 숨긴다).
  othersAvgPct: number | null;
  // 평균을 낸 사람 수(나 제외).
  othersCount: number;
};

// RPC paper_round_score_stats 는 authenticated 전용(schema.sql) — 로그인 시에만 부를 것.
// 조회 실패는 빈 배열로 뭉개지 않고 null 을 돌려준다(빈 배열이면 화면이 "표본 부족"이라고
// 단언해 버리는데 실제 원인은 함수 미적용일 수 있다).
export async function fetchPaperRoundComparisons(
  client: SupabaseClient,
  paperId: string,
  rounds: { round: number; score: number; totalQuestions: number }[],
): Promise<PaperRoundComparison[] | null> {
  if (rounds.length === 0) return [];
  const { data, error } = await client.rpc("paper_round_score_stats", { p_paper_id: paperId });
  if (error) return null;
  const byRound = new Map(
    ((data ?? []) as { round_number: number; attempts: number; pct_sum: number }[]).map((s) => [
      s.round_number,
      { attempts: Number(s.attempts), pctSum: Number(s.pct_sum) },
    ]),
  );
  return rounds
    .filter((r) => r.totalQuestions > 0)
    .map((r) => {
      const myPct = (r.score * 100) / r.totalQuestions;
      const stat = byRound.get(r.round);
      const includesMe = (stat?.attempts ?? 0) > 0;
      return {
        round: r.round,
        myPct: Math.round(myPct),
        othersAvgPct: stat ? othersRoundAveragePct(stat.attempts, stat.pctSum, includesMe ? myPct : null) : null,
        othersCount: Math.max(0, (stat?.attempts ?? 0) - (includesMe ? 1 : 0)),
      };
    });
}
