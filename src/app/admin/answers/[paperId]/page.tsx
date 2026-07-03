import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AnswerForm } from "./answer-form";

export default async function AnswerEditPage({
  params,
}: {
  params: Promise<{ paperId: string }>;
}) {
  const { paperId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const [{ data: paper }, { data: existing }] = await Promise.all([
    supabase
      .from("exam_papers")
      .select("id, title, year, question_count, choice_count")
      .eq("id", paperId)
      .single(),
    supabase
      .from("paper_answers")
      .select("answers")
      .eq("paper_id", paperId)
      .maybeSingle(),
  ]);

  if (!paper) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-16">
      <Link href="/admin/answers" className="text-sm text-blue-600 underline">
        ← 목록으로
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">{paper.title}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {paper.year}년
          {paper.question_count ? ` · 문항 수 ${paper.question_count}개` : ""}
        </p>
      </div>

      <AnswerForm
        paperId={paper.id}
        initialAnswers={(existing?.answers ?? []).join(", ")}
        questionCount={paper.question_count}
        initialChoiceCount={paper.choice_count ?? 4}
      />
    </div>
  );
}
