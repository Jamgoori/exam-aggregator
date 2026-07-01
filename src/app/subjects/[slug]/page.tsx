import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
    .select("*, exam_types(*)")
    .eq("subject_id", (subject as Subject).id)
    .order("year", { ascending: false })
    .order("round", { ascending: false });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
      <div>
        <Link href="/" className="text-sm text-zinc-500 underline">
          ← 전체 과목
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">
          {(subject as Subject).name}
        </h1>
      </div>

      <div className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200">
        {((papers ?? []) as ExamPaper[]).length === 0 && (
          <p className="px-4 py-6 text-zinc-500">
            아직 업로드된 기출문제가 없습니다.
          </p>
        )}
        {((papers ?? []) as ExamPaper[]).map((paper) => {
          const { data } = supabase.storage
            .from("exam-papers")
            .getPublicUrl(paper.file_path);

          return (
            <a
              key={paper.id}
              href={data.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between px-4 py-4 hover:bg-zinc-50"
            >
              <div>
                <p className="font-medium">{paper.title}</p>
                <p className="text-sm text-zinc-500">
                  {paper.exam_types?.name} · {paper.year}
                  {paper.round > 1 ? ` · ${paper.round}회차` : ""}
                </p>
              </div>
              <span className="text-sm text-zinc-400">PDF 보기</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
