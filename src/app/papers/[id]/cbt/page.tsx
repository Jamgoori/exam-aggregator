import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CbtSolver } from "@/components/cbt-solver";
import type { ExamPaper } from "@/lib/supabase/types";

export default async function CbtPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/papers/${id}/cbt`)}`);
  }

  const [{ data: paper }, { data: hasAnswers }] = await Promise.all([
    supabase
      .from("exam_papers")
      .select("*, subjects(*), exam_types(*)")
      .eq("id", id)
      .single(),
    supabase.rpc("has_cbt_answers", { target_paper_id: id }),
  ]);

  if (!paper) {
    notFound();
  }

  const typedPaper = paper as ExamPaper;

  if (!hasAnswers || !typedPaper.question_count) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">아직 CBT를 지원하지 않는 문제지예요</h1>
        <p className="text-sm text-zinc-500">
          정답이 등록되면 CBT로 풀 수 있어요. 우선 원본 PDF로 풀어보세요.
        </p>
        <Link
          href={`/papers/${typedPaper.id}`}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          문제지로 돌아가기
        </Link>
      </div>
    );
  }

  const { data: paperFileUrl } = supabase.storage
    .from("exam-papers")
    .getPublicUrl(typedPaper.file_path);

  return (
    <CbtSolver
      paperId={typedPaper.id}
      paperTitle={typedPaper.title}
      fileUrl={paperFileUrl.publicUrl}
      totalQuestions={typedPaper.question_count}
      subjectName={typedPaper.subjects?.name ?? null}
      examTypeName={typedPaper.exam_types?.name ?? null}
      level={typedPaper.level}
    />
  );
}
