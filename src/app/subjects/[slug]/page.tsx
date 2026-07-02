import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import type { ExamPaper, Subject } from "@/lib/supabase/types";

export default async function SubjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: subject } = await supabase
    .from("subjects")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!subject) {
    notFound();
  }

  const { data: papers } = await supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types(*)")
    .eq("subject_id", (subject as Subject).id)
    .order("year", { ascending: false })
    .order("round", { ascending: false });

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-12">
      <div>
        <Link href="/" className="text-sm text-zinc-500 underline">
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">
          {(subject as Subject).name}
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {((papers ?? []) as ExamPaper[]).length === 0 && (
          <p className="col-span-full py-12 text-center text-zinc-500">
            아직 업로드된 기출문제가 없습니다.
          </p>
        )}
        {((papers ?? []) as ExamPaper[]).map((paper) => (
          <ExamCard key={paper.id} paper={paper} />
        ))}
      </div>
    </div>
  );
}
