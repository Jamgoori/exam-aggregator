import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink, Monitor } from "lucide-react";
import { subjectColor } from "@/lib/subject-colors";
import { levelColor } from "@/lib/level-colors";
import { DifficultyRating } from "@/components/difficulty-rating";
import { CommentsSection } from "@/components/comments-section";
import { ExamCard } from "@/components/exam-card";
import { BookmarkButton } from "@/components/bookmark-button";
import { MyCbtRecordModal } from "@/components/my-cbt-record-modal";
import { getPaper, getPaperDetailData } from "./paper-detail-data";
import type { ExamPaper } from "@/lib/supabase/types";
import type { Metadata } from "next";

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

  const paper = await getPaper(id);

  if (!paper) {
    notFound();
  }

  const {
    userId,
    loggedIn,
    isAdmin,
    comments,
    averageScore,
    voteCount,
    myScore,
    isBookmarked,
    hasCbtAnswers,
    roundAverages,
    myCbtRecordItems,
    subjectPapers,
    availableLevels,
    myRoundCounts,
    subjectBookmarkedIds,
    subjectCbtAvailability,
    paperFileUrl,
    answerKey,
    answerKeyFileUrl,
  } = await getPaperDetailData(paper, level);

  const subject = paper.subjects;
  const examType = paper.exam_types;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-4 pb-12 pt-6 sm:pt-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-14">
      <div className="flex flex-col gap-4">
        <Link href="/" className="text-sm text-zinc-500 hover:text-blue-600">
          ← 홈으로
        </Link>

        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {paper.level && (
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold ${levelColor(paper.level)}`}
              >
                {paper.level}
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
            paperId={paper.id}
            initialBookmarked={isBookmarked}
            loggedIn={loggedIn}
          />
        </div>

        <div>
          <h1 className="text-3xl font-bold leading-snug">
            {paper.title}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {examType?.name}
            {examType?.name ? " · " : ""}
            {paper.year}년
            {paper.round > 1 ? ` · ${paper.round}회차` : ""}
            {paper.question_count
              ? ` · ${paper.question_count}문제`
              : ""}
          </p>
          {paper.tags.length > 0 && (
            <p className="mt-1 text-sm text-zinc-400">
              {paper.tags.map((tag) => `#${tag}`).join(" ")}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-stretch gap-2">
          <a
            href={paperFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-4 text-lg font-medium text-white hover:bg-blue-700"
          >
            <ExternalLink size={20} />
            문제 열기
          </a>
          <a
            href={`/download/${paper.id}`}
            aria-label="문제 다운로드"
            title="문제 다운로드"
            className="flex shrink-0 items-center justify-center rounded-xl border border-zinc-300 px-5 text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
          >
            <Download size={20} />
          </a>
        </div>

        {answerKey && answerKeyFileUrl && (
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
              href={`/download/answer/${answerKey.id}`}
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
            href={`/papers/${paper.id}/cbt`}
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
        paperId={paper.id}
        averageScore={averageScore}
        voteCount={voteCount}
        loggedIn={loggedIn}
        initialMyScore={myScore}
      />

      <CommentsSection
        paperId={paper.id}
        comments={comments}
        currentUserId={userId}
        loggedIn={loggedIn}
        isAdmin={isAdmin}
      />
      </div>

      {subject && subjectPapers?.length ? (
        <RelatedPapersSection
          subject={subject}
          papers={subjectPapers}
          availableLevels={availableLevels}
          level={level}
          currentPaperId={paper.id}
          myRoundCounts={myRoundCounts}
          bookmarkedIds={subjectBookmarkedIds}
          cbtAvailability={subjectCbtAvailability}
          loggedIn={loggedIn}
        />
      ) : null}
    </div>
  );
}

// "같은 과목 기출문제 목록" 섹션: 급수 탭(그 과목에 실제 존재하는 급수가 2개
// 이상일 때만) + 최근 문제지 카드 그리드.
function RelatedPapersSection({
  subject,
  papers,
  availableLevels,
  level,
  currentPaperId,
  myRoundCounts,
  bookmarkedIds,
  cbtAvailability,
  loggedIn,
}: {
  subject: NonNullable<ExamPaper["subjects"]>;
  papers: ExamPaper[];
  availableLevels: string[];
  level?: string;
  currentPaperId: string;
  myRoundCounts: Map<string, number>;
  bookmarkedIds: Set<string>;
  cbtAvailability: Set<string>;
  loggedIn: boolean;
}) {
  return (
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

      {availableLevels.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/papers/${currentPaperId}`}
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
              href={`/papers/${currentPaperId}?level=${encodeURIComponent(lv)}`}
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
        {papers.length === 0 && (
          <p className="col-span-full py-8 text-center text-zinc-500">
            해당 급수의 기출문제가 없습니다.
          </p>
        )}
        {papers.map((p) => (
          <ExamCard
            key={p.id}
            paper={p}
            isCurrent={p.id === currentPaperId}
            linkLevel={level}
            myRoundCount={myRoundCounts.get(p.id)}
            isBookmarked={bookmarkedIds.has(p.id)}
            loggedIn={loggedIn}
            hasCbtAnswers={cbtAvailability.has(p.id)}
          />
        ))}
      </div>
    </div>
  );
}
