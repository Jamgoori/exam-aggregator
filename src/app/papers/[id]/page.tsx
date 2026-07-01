import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { subjectColor } from "@/lib/subject-colors";
import { formatCount, formatFileSize } from "@/lib/format";
import { postComment } from "@/app/papers/actions";
import { DifficultyRating } from "@/components/difficulty-rating";
import type { Comment, ExamPaper } from "@/lib/supabase/types";

export default async function PaperDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createClient();

  const { data: paper } = await supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types(*)")
    .eq("id", id)
    .single();

  if (!paper) {
    notFound();
  }

  const typedPaper = paper as ExamPaper;

  const [{ data: comments }, { data: ratings }, userResult] = await Promise.all([
    supabase
      .from("comments")
      .select("*")
      .eq("paper_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("difficulty_ratings").select("score").eq("paper_id", id),
    supabase.auth.getUser(),
  ]);

  const scores = (ratings ?? []).map((r) => r.score as number);
  const averageScore =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const loggedIn = !!userResult.data.user;

  const subject = typedPaper.subjects;
  const examType = typedPaper.exam_types;
  const fileSize = formatFileSize(typedPaper.file_size);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <div>
        {subject && (
          <Link
            href={`/subjects/${subject.slug}`}
            className="text-sm text-zinc-500 underline"
          >
            ← {subject.name} 목록으로
          </Link>
        )}

        <div className="mt-3 flex items-center gap-2">
          {subject && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(subject.slug)}`}
            >
              {subject.name}
            </span>
          )}
          {typedPaper.level && (
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              {typedPaper.level}
            </span>
          )}
        </div>

        <h1 className="mt-2 text-2xl font-semibold">{typedPaper.title}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {examType?.name}
          {examType?.name ? " · " : ""}
          {typedPaper.year}년
          {typedPaper.round > 1 ? ` · ${typedPaper.round}회차` : ""}
          {typedPaper.question_count ? ` · ${typedPaper.question_count}문제` : ""}
        </p>
        {typedPaper.tags.length > 0 && (
          <p className="mt-1 text-sm text-zinc-400">
            {typedPaper.tags.map((tag) => `#${tag}`).join(" ")}
          </p>
        )}
      </div>

      <a
        href={`/download/${typedPaper.id}`}
        className="flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white hover:bg-zinc-700"
      >
        <Download size={18} />
        PDF 다운로드
        <span className="text-sm text-zinc-300">
          (다운로드 {formatCount(typedPaper.download_count)}회
          {fileSize ? ` · ${fileSize}` : ""})
        </span>
      </a>

      <DifficultyRating
        paperId={typedPaper.id}
        averageScore={averageScore}
        voteCount={scores.length}
        loggedIn={loggedIn}
      />

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold">댓글 {comments?.length ?? 0}개</h2>

        <form action={postComment} className="flex flex-col gap-2">
          <input type="hidden" name="paper_id" value={typedPaper.id} />
          {!loggedIn && (
            <input
              name="nickname"
              placeholder="닉네임"
              required
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            />
          )}
          <textarea
            name="content"
            placeholder="이 시험에 대한 의견을 남겨주세요"
            required
            rows={3}
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            className="self-end rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            댓글 등록
          </button>
        </form>

        <div className="flex flex-col divide-y divide-zinc-100">
          {((comments ?? []) as Comment[]).length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-500">
              아직 댓글이 없어요. 첫 댓글을 남겨보세요.
            </p>
          )}
          {((comments ?? []) as Comment[]).map((comment) => (
            <div key={comment.id} className="flex flex-col gap-1 py-3">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{comment.nickname}</span>
                <span className="text-xs text-zinc-400">
                  {new Date(comment.created_at).toLocaleDateString("ko-KR")}
                </span>
              </div>
              <p className="text-sm text-zinc-700 whitespace-pre-wrap">
                {comment.content}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
