import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { subjectColor } from "@/lib/subject-colors";
import { levelColor, compareLevels } from "@/lib/level-colors";
import { formatCount, formatFileSize } from "@/lib/format";
import { DifficultyRating } from "@/components/difficulty-rating";
import { CommentsSection } from "@/components/comments-section";
import { ExamCard } from "@/components/exam-card";
import type { AnswerKey, Comment, ExamPaper } from "@/lib/supabase/types";
import type { Metadata } from "next";

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

  const [{ data: comments }, { data: ratings }, userResult, { data: answerKey }] =
    await Promise.all([
      supabase
        .from("comments")
        .select("id, paper_id, user_id, nickname, content, created_at, updated_at")
        .eq("paper_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("difficulty_ratings").select("score").eq("paper_id", id),
      supabase.auth.getUser(),
      answerKeyQuery.maybeSingle(),
    ]);

  const { data: subjectPapers } = typedPaper.subject_id
    ? await supabase
        .from("exam_papers")
        .select("*, subjects(*), exam_types(*)")
        .eq("subject_id", typedPaper.subject_id)
        .order("year", { ascending: false })
        .order("round", { ascending: false })
    : { data: null };

  const scores = (ratings ?? []).map((r) => r.score as number);
  const averageScore =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const currentUser = userResult.data.user;
  const loggedIn = !!currentUser;
  const { data: isAdminData } = loggedIn
    ? await supabase.rpc("is_admin")
    : { data: false };
  const isAdmin = isAdminData === true;

  const subject = typedPaper.subjects;
  const examType = typedPaper.exam_types;
  const fileSize = formatFileSize(typedPaper.file_size);

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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
      <div className="flex flex-col gap-4">
        <Link href="/" className="text-sm text-zinc-500 hover:text-blue-600">
          ← 홈으로
        </Link>

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

      <div className="flex flex-col gap-2">
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
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-4 font-medium text-blue-700 hover:bg-blue-100"
            >
              <ExternalLink size={18} />
              정답 열기
            </a>
            <a
              href={`/download/answer/${typedAnswerKey.id}`}
              aria-label="정답 다운로드"
              title="정답 다운로드"
              className="flex shrink-0 items-center justify-center rounded-xl border border-zinc-300 px-5 text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
            >
              <Download size={18} />
            </a>
          </div>
        )}

        <p className="mt-1 text-xs text-zinc-400">
          다운로드 {formatCount(typedPaper.download_count)}회
          {fileSize ? ` · ${fileSize}` : ""}
        </p>
      </div>

      <DifficultyRating
        paperId={typedPaper.id}
        averageScore={averageScore}
        voteCount={scores.length}
        loggedIn={loggedIn}
      />

      <CommentsSection
        paperId={typedPaper.id}
        comments={(comments ?? []) as Comment[]}
        currentUserId={currentUser?.id ?? null}
        loggedIn={loggedIn}
        isAdmin={isAdmin}
      />
      </div>

      {subject && (subjectPapers as ExamPaper[] | null)?.length ? (
        <div className="flex flex-col gap-4 border-t border-zinc-100 pt-10">
          <h2 className="text-lg font-semibold">
            {subject.name} 기출문제 목록
          </h2>

          {(() => {
            const allSubjectPapers = subjectPapers as ExamPaper[];
            const availableLevels = [
              ...new Set(
                allSubjectPapers
                  .map((p) => p.level)
                  .filter((l): l is string => !!l),
              ),
            ].sort(compareLevels);
            const filteredSubjectPapers = level
              ? allSubjectPapers.filter((p) => p.level === level)
              : allSubjectPapers;

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
