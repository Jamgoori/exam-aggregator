import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { subjectColor } from "@/lib/subject-colors";
import type { Subject } from "@/lib/supabase/types";

export default async function SubjectsIndexPage() {
  const supabase = await createClient();
  const { data: subjects } = await supabase
    .from("subjects")
    .select("*")
    .order("display_order");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-12">
      <div>
        <h1 className="text-2xl font-semibold">과목별로 보기</h1>
        <p className="mt-1 text-zinc-600">과목을 선택하면 기출문제 목록을 볼 수 있어요.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {((subjects ?? []) as Subject[]).map((subject) => (
          <Link
            key={subject.id}
            href={`/subjects/${subject.slug}`}
            className="flex flex-col items-center gap-2 rounded-lg border border-zinc-200 px-4 py-6 hover:border-zinc-400"
          >
            <span
              className={`rounded px-3 py-1 text-sm font-medium ${subjectColor(subject.slug)}`}
            >
              {subject.name}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
