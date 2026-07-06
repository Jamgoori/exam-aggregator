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

  // 로그인만 한 일반 계정이 관리자 화면을 열어보지 못하게 막는다 (데이터 쓰기는
  // 어차피 RLS가 막지만, 관리자 UI 자체를 노출할 이유가 없다).
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) {
    redirect("/");
  }

  const [{ data: paper }, { data: existing }] = await Promise.all([
    supabase
      .from("exam_papers")
      .select("id, title, year, question_count")
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
      />
    </div>
  );
}
