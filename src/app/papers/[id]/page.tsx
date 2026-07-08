import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Monitor } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { subjectColor } from "@/lib/subject-colors";
import { levelColor, compareLevels } from "@/lib/level-colors";
import { DifficultyRating } from "@/components/difficulty-rating";
import { CommentsSection } from "@/components/comments-section";
import { ExamCard } from "@/components/exam-card";
import { BookmarkButton } from "@/components/bookmark-button";
import {
  MyCbtRecordModal,
  type MyCbtRecordItem,
  type RoundAverage,
} from "@/components/my-cbt-record-modal";
import { getMyRoundCounts } from "@/lib/my-round-counts";
import { getMyBookmarkedPaperIds } from "@/lib/bookmarks";
import { getCbtAvailability } from "@/lib/cbt-availability";
import type { AnswerKey, Comment, ExamPaper } from "@/lib/supabase/types";
import type { Metadata } from "next";

const RELATED_PAPERS_LIMIT = 12;

// generateMetadata와 페이지 본문이 같은 id로 중복 조회하지 않도록 캐싱
const getPaper = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types(*)")
    .eq("id", id)
    .single();
  return data as ExamPaper | null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const paper = await getPaper(id);
  if (!paper) return {};

  const subject = paper.subjects;
  const examType = paper.exam_types;
  const title = `${paper.title} 기출문제`;
  const description = `${examType?.name ?? ""} ${paper.level ?? ""} ${paper.year}년 ${subject?.name ?? ""} 기출문제를 정답과 함께 무료로 열람·다운로드하세요.`
    .replace(/\s+/g, " ")
    .trim();

  return { title, description };
}

export default async function PaperDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ level?: string }>;
}) {
  const { id } = await params;
  const { level } = await searchParams;
  const supabase = await createClient();

  const paper = await getPaper(id);

  if (!paper) {
    notFound();
  }

  const typedPaper = paper;

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
    .eq("exam_type_id", typedPaper.exam_type_id)
    .eq("year", typedPaper.year)
    .eq("round", typedPaper.round);
  answerKeyQuery = typedPaper.level
    ? answerKeyQuery.eq("level", typedPaper.level)
    : answerKeyQuery.is("level", null);
  answerKeyQuery = typedPaper.track
    ? answerKeyQuery.eq("track", typedPaper.track)
    : answerKeyQuery.is("track", null);

  // "같은 과목 목록"은 미리보기 성격이라 최근 RELATED_PAPERS_LIMIT개만 보여주고,
  // 전체 목록은 /subjects/[slug] 페이지(페이지네이션 적용됨)로 넘긴다.
  // 급수 탭은 이 과목에 존재하는 급수 종류만 필요하므로 level 컬럼만 가볍게 조회한다.
  let subjectPapersQuery = typedPaper.subject_id
    ? supabase
        .from("exam_papers")
        .select("*, subjects(*), exam_types(*)")
        .eq("subject_id", typedPaper.subject_id)
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
      .eq("paper_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("difficulty_ratings").select("score").eq("paper_id", id),
    answerKeyQuery.maybeSingle(),
    supabase.rpc("has_cbt_answers", { target_paper_id: id }),
    supabase.rpc("avg_score_by_round", { target_paper_id: id }),
    subjectPapersQuery
      ? subjectPapersQuery
          .order("year", { ascending: false })
          .order("round", { ascending: false })
          .limit(RELATED_PAPERS_LIMIT)
      : Promise.resolve({ data: null }),
    typedPaper.subject_id
      ? supabase
          .from("exam_papers")
          .select("level")
          .eq("subject_id", typedPaper.subject_id)
      : Promise.resolve({ data: null }),
    loggedIn ? supabase.rpc("is_admin") : Promise.resolve({ data: false }),
    userId
      ? supabase
          .from("bookmarks")
          .select("id")
          .eq("user_id", userId)
          .eq("paper_id", typedPaper.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase
          .from("difficulty_ratings")
          .select("score")
          .eq("paper_id", typedPaper.id)
          .eq("user_id", userId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    userId
      ? supabase
          .from("cbt_attempts")
          .select("id, score, total_questions, created_at")
          .eq("paper_id", typedPaper.id)
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
  const isAdmin = isAdminData === true;

  const isBookmarked = !!bookmarkData;
  const myScore = myRatingData ? (myRatingData.score as number) : null;

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

  const subject = typedPaper.subjects;
  const examType = typedPaper.exam_types;

  // "같은 과목 목록" 카드에 북마크/바로풀기를 달아주기 위한 배치 조회. subjectPapers의
  // id는 위 Promise.all이 끝나야 알 수 있어서 그 안에 묶지 못하고 여기서 한 번 더
  // 병렬 조회한다(현재 보는 문제지 자신은 카드에서 두 기능 다 안 쓰니 제외).
  const subjectPaperIds = ((subjectPapers as ExamPaper[] | null) ?? [])
    .map((p) => p.id)
    .filter((pid) => pid !== typedPaper.id);
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
    .getPublicUrl(typedPaper.file_path);
  const typedAnswerKey = answerKey as AnswerKey | null;
  const answerKeyFileUrl = typedAnswerKey
    ? supabase.storage.from("exam-papers").getPublicUrl(typedAnswerKey.file_path)
        .data.publicUrl
    : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-4 pb-12 pt-6 sm:pt-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-14">
      <div className="flex flex-col gap-4">
        <Link href="/" className="text-sm text-zinc-500 hover:text-blue-600">
          ← 홈으로
        </Link>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {typedPaper.level && (
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold ${levelColor(typedPaper.level)}`}
              >
                {typedPaper.level}
              </span>
            )}
            {subject && (
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(subject.slug)}`}
              >
                {subject.name}
              </span>
            )}
          </div>
          <BookmarkButton
            paperId={typedPaper.id}
            initialBookmarked={isBookmarked}
            loggedIn={loggedIn}
          />
        </div>

        <div>
          <h1 className="text-3xl font-bold leading-snug">
            {typedPaper.title}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {examType?.name}
            {examType?.name ? " · " : ""}
            {typedPaper.year}년
            {typedPaper.round > 1 ? ` · ${typedPaper.round}회차` : ""}
            {typedPaper.question_count
              ? ` · ${typedPaper.question_count}문제`
              : ""}
          </p>
          {typedPaper.tags.length > 0 && (
            <p className="mt-1 text-sm text-zinc-400">
              {typedPaper.tags.map((tag) => `#${tag}`).join(" ")}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-stretch gap-2">
          <a
            href={paperFileUrl.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-4 text-lg font-medium text-white hover:bg-blue-700"
          >
            <ExternalLink size={20} />
            문제 열기
          </a>
          <a
            href={`/download/${typedPaper.id}`}
            aria-label="문제 다운로드"
            title="문제 다운로드"
            className="flex shrink-0 items-center justify-center rounded-xl border border-zinc-300 px-5 text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
          >
            <Download size={20} />
          </a>
        </div>

        {typedAnswerKey && answerKeyFileUrl && (
          <div className="flex items-stretch gap-2">
            <a
              href={answerKeyFileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 text-lg font-medium text-blue-700 hover:bg-blue-100"
            >
              <ExternalLink size={20} />
              정답 열기
            </a>
            <a
              href={`/download/answer/${typedAnswerKey.id}`}
              aria-label="정답 다운로드"
              title="정답 다운로드"
              className="flex shrink-0 items-center justify-center rounded-xl border border-zinc-300 px-5 text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
            >
              <Download size={20} />
            </a>
          </div>
        )}

        {hasCbtAnswers && (
          <Link
            href={`/papers/${typedPaper.id}/cbt`}
            className="flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 text-lg font-medium text-blue-700 hover:bg-blue-100"
          >
            <Monitor size={20} />
            온라인에서 풀기
          </Link>
        )}

        {myCbtRecordItems.length > 0 && (
          <div className="mt-1 flex items-center justify-end gap-2 text-xs text-zinc-400">
            <MyCbtRecordModal attempts={myCbtRecordItems} roundAverages={roundAverages} />
          </div>
        )}
      </div>

      <DifficultyRating
        paperId={typedPaper.id}
        averageScore={averageScore}
        voteCount={scores.length}
        loggedIn={loggedIn}
        initialMyScore={myScore}
      />

      <CommentsSection
        paperId={typedPaper.id}
        comments={(comments ?? []) as Comment[]}
        currentUserId={userId}
        loggedIn={loggedIn}
        isAdmin={isAdmin}
      />
      </div>

      {subject && (subjectPapers as ExamPaper[] | null)?.length ? (
        <div className="flex flex-col gap-4 border-t border-zinc-100 pt-14">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-semibold">
              {subject.name} 기출문제 목록
            </h2>
            <Link
              href={`/subjects/${subject.slug}${level ? `?level=${encodeURIComponent(level)}` : ""}`}
              className="shrink-0 text-sm font-medium text-blue-600 hover:underline"
            >
              전체보기
            </Link>
          </div>

          {(() => {
            const filteredSubjectPapers = subjectPapers as ExamPaper[];
            const availableLevels = [
              ...new Set(
                (subjectLevelRows ?? [])
                  .map((r) => r.level)
                  .filter((l): l is string => !!l),
              ),
            ].sort(compareLevels);

            return (
              <>
                {availableLevels.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/papers/${typedPaper.id}`}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                        !level
                          ? "bg-zinc-800 text-white"
                          : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
                      }`}
                    >
                      전체
                    </Link>
                    {availableLevels.map((lv) => (
                      <Link
                        key={lv}
                        href={`/papers/${typedPaper.id}?level=${encodeURIComponent(lv)}`}
                        className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                          level === lv
                            ? levelColor(lv)
                            : "border border-zinc-200 text-zinc-600 hover:border-zinc-400"
                        }`}
                      >
                        {lv}
                      </Link>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredSubjectPapers.length === 0 && (
                    <p className="col-span-full py-8 text-center text-zinc-500">
                      해당 급수의 기출문제가 없습니다.
                    </p>
                  )}
                  {filteredSubjectPapers.map((p) => (
                    <ExamCard
                      key={p.id}
                      paper={p}
                      isCurrent={p.id === typedPaper.id}
                      linkLevel={level}
                      myRoundCount={myRoundCounts.get(p.id)}
                      isBookmarked={subjectBookmarkedIds.has(p.id)}
                      loggedIn={loggedIn}
                      hasCbtAnswers={subjectCbtAvailability.has(p.id)}
                    />
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
