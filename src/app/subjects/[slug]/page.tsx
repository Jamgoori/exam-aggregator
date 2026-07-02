import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { levelColor, compareLevels } from "@/lib/level-colors";
import type { ExamPaper, Subject } from "@/lib/supabase/types";

export default async function SubjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ level?: string }>;
}) {
  const { slug } = await params;
  const { level } = await searchParams;
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

  const allPapers = (papers ?? []) as ExamPaper[];
  const availableLevels = [
    ...new Set(allPapers.map((p) => p.level).filter((l): l is string => !!l)),
  ].sort(compareLevels);
  const filteredPapers = level
    ? allPapers.filter((p) => p.level === level)
    : allPapers;

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

      {availableLevels.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/subjects/${slug}`}
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
              href={`/subjects/${slug}?level=${encodeURIComponent(lv)}`}
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredPapers.length === 0 && (
          <p className="col-span-full py-12 text-center text-zinc-500">
            {allPapers.length === 0
              ? "아직 업로드된 기출문제가 없습니다."
              : "해당 급수의 기출문제가 없습니다."}
          </p>
        )}
        {filteredPapers.map((paper) => (
          <ExamCard key={paper.id} paper={paper} />
        ))}
      </div>
    </div>
  );
}
