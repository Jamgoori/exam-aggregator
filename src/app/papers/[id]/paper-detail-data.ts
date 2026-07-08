import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { compareLevels } from "@/lib/level-colors";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getCbtAvailability } from "@/lib/cbt-availability";
import type {
  MyCbtRecordItem,
  RoundAverage,
} from "@/components/my-cbt-record-modal";
import type { AnswerKey, Comment, ExamPaper } from "@/lib/supabase/types";

const RELATED_PAPERS_LIMIT = 12;

// generateMetadata와 페이지 본문이 같은 id로 중복 조회하지 않도록 캐싱
export const getPaper = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types(*)")
    .eq("id", id)
    .single();
  return data as ExamPaper | null;
});

// 상세페이지 렌더링에 필요한 모든 데이터를 모아서 돌려준다. 어떤 쿼리를 어떻게
// 묶어서 날리는지(왕복 횟수)는 전부 여기서 결정하고, 페이지 컴포넌트는 받은 값을
// 그리기만 한다.
export async function getPaperDetailData(paper: ExamPaper, level?: string) {
  const supabase = await createClient();

  // 사용자 식별은 JWT 로컬 검증(getClaims)으로 충분하다 — 아래의 개인화 쿼리
  // (북마크/내 평가/내 응시 기록)는 전부 RLS가 본인 것만 돌려주므로 인증 서버
  // 왕복(getUser) 없이 곧바로 나머지 조회 전체를 한 번에 병렬로 날릴 수 있다
  // (예전에는 getUser 결과를 기다리는 단계들이 줄줄이 이어져 왕복이 5~6번이었다).
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub ?? null;
  const loggedIn = !!userId;

  let answerKeyQuery = supabase
    .from("answer_keys")
    .select("*")
    .eq("exam_type_id", paper.exam_type_id)
    .eq("year", paper.year)
    .eq("round", paper.round);
  answerKeyQuery = paper.level
    ? answerKeyQuery.eq("level", paper.level)
    : answerKeyQuery.is("level", null);
  answerKeyQuery = paper.track
    ? answerKeyQuery.eq("track", paper.track)
    : answerKeyQuery.is("track", null);

  // "같은 과목 목록"은 미리보기 성격이라 최근 RELATED_PAPERS_LIMIT개만 보여주고,
  // 전체 목록은 /subjects/[slug] 페이지(페이지네이션 적용됨)로 넘긴다.
  // 급수 탭은 이 과목에 존재하는 급수 종류만 필요하므로 level 컬럼만 가볍게 조회한다.
  let subjectPapersQuery = paper.subject_id
    ? supabase
        .from("exam_papers")
        .select("*, subjects(*), exam_types(*)")
        .eq("subject_id", paper.subject_id)
    : null;
  if (subjectPapersQuery && level) {
    subjectPapersQuery = subjectPapersQuery.eq("level", level);
  }

  const [
    { data: comments },
    { data: ratings },
    { data: answerKey },
    { data: hasCbtAnswers },
    { data: roundAverageRows },
    { data: subjectPapers },
    { data: subjectLevelRows },
    { data: isAdminData },
    { data: bookmarkData },
    { data: myRatingData },
    { data: myCbtAttemptRows },
    myRoundCounts,
  ] = await Promise.all([
    supabase
      .from("comments")
      .select("id, paper_id, user_id, nickname, content, created_at, updated_at, parent_id")
      .eq("paper_id", paper.id)
      .order("created_at", { ascending: true }),
    supabase.from("difficulty_ratings").select("score").eq("paper_id", paper.id),
    answerKeyQuery.maybeSingle(),
    supabase.rpc("has_cbt_answers", { target_paper_id: paper.id }),
    supabase.rpc("avg_score_by_round", { target_paper_id: paper.id }),
    subjectPapersQuery
      ? subjectPapersQuery
          .order("year", { ascending: false })
          .order("round", { ascending: false })
          .limit(RELATED_PAPERS_LIMIT)
      : Promise.resolve({ data: null }),
    paper.subject_id
      ? supabase
          .from("exam_papers")
          .select("level")
          .eq("subject_id", paper.subject_id)
      : Promise.resolve({ data: null }),
    loggedIn ? supabase.rpc("is_admin") : Promise.resolve({ data: false }),
    userId
      ? supabase
          .from("bookmarks")
          .select("id")
          .eq("user_id", userId)
          .eq("paper_id", paper.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase
          .from("difficulty_ratings")
          .select("score")
          .eq("paper_id", paper.id)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase
          .from("cbt_attempts")
          .select("id, score, total_questions, created_at")
          .eq("paper_id", paper.id)
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: null }),
    // "같은 과목 목록" 카드에 회독 배지를 달아주기 위한 문제지별 응시 횟수.
    userId
      ? getMyRoundCounts(supabase, userId)
      : Promise.resolve(new Map<string, number>()),
  ]);

  // 표본 3명 미만인 회차는 DB 함수에서 이미 제외하고 내려주므로 여기서는 그대로 매핑만 한다.
  const roundAverages: RoundAverage[] = (
    (roundAverageRows ?? []) as { round: number; avg_pct: number; attempt_count: number }[]
  ).map((r) => ({
    round: r.round,
    avgPct: r.avg_pct,
    attemptCount: r.attempt_count,
  }));

  const scores = (ratings ?? []).map((r) => r.score as number);
  const averageScore =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const myCbtAttempts = (myCbtAttemptRows ?? []) as {
    id: string;
    score: number;
    total_questions: number;
    created_at: string;
  }[];
  // 이 페이지는 문제지 하나만 다루므로, 오래된 순으로 이미 받아온 목록에 순서대로
  // 회차 번호(1회독, 2회독...)를 매기면 된다.
  const myCbtRecordItems: MyCbtRecordItem[] = myCbtAttempts.map((a, i) => ({
    id: a.id,
    round: i + 1,
    score: a.score,
    totalQuestions: a.total_questions,
    createdAt: a.created_at,
  }));

  // 급수 탭에는 이 과목에 실제로 존재하는 급수만 보여준다.
  const availableLevels = [
    ...new Set(
      (subjectLevelRows ?? [])
        .map((r) => r.level)
        .filter((l): l is string => !!l),
    ),
  ].sort(compareLevels);

  // "같은 과목 목록" 카드에 북마크/바로풀기를 달아주기 위한 배치 조회. subjectPapers의
  // id는 위 Promise.all이 끝나야 알 수 있어서 그 안에 묶지 못하고 여기서 한 번 더
  // 병렬 조회한다(현재 보는 문제지 자신은 카드에서 두 기능 다 안 쓰니 제외).
  const subjectPaperIds = ((subjectPapers as ExamPaper[] | null) ?? [])
    .map((p) => p.id)
    .filter((pid) => pid !== paper.id);
  const [subjectBookmarkedIds, subjectCbtAvailability] = await Promise.all([
    userId
      ? getMyBookmarkedPaperIds(supabase, userId, subjectPaperIds)
      : Promise.resolve(new Set<string>()),
    getCbtAvailability(supabase, subjectPaperIds),
  ]);

  // "열기"는 브라우저 내장 뷰어로 바로 보여주는 원본 URL (다운로드 카운트 미반영),
  // "다운로드"는 /download 라우트를 거쳐 실제 파일 저장 + 카운트 반영
  const { data: paperFileUrl } = supabase.storage
    .from("exam-papers")
    .getPublicUrl(paper.file_path);
  const typedAnswerKey = answerKey as AnswerKey | null;
  const answerKeyFileUrl = typedAnswerKey
    ? supabase.storage.from("exam-papers").getPublicUrl(typedAnswerKey.file_path)
        .data.publicUrl
    : null;

  return {
    userId,
    loggedIn,
    isAdmin: isAdminData === true,
    comments: (comments ?? []) as Comment[],
    averageScore,
    voteCount: scores.length,
    myScore: myRatingData ? (myRatingData.score as number) : null,
    isBookmarked: !!bookmarkData,
    hasCbtAnswers,
    roundAverages,
    myCbtRecordItems,
    subjectPapers: subjectPapers as ExamPaper[] | null,
    availableLevels,
    myRoundCounts,
    subjectBookmarkedIds,
    subjectCbtAvailability,
    paperFileUrl: paperFileUrl.publicUrl,
    answerKey: typedAnswerKey,
    answerKeyFileUrl,
  };
}
