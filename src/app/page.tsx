import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Subject } from "@/lib/supabase/types";

export default async function Home() {
  const supabase = await createClient();
  const { data: subjects } = await supabase
    .from("subjects")
    .select("*")
    .order("display_order");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-16">
      <div>
        <h1 className="text-3xl font-semibold">공무원 기출문제 아카이브</h1>
        <p className="mt-2 text-zinc-600">
          과목을 선택하면 업로드된 기출문제를 연도·시험별로 볼 수 있어요.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {((subjects ?? []) as Subject[]).map((subject) => (
          <Link
            key={subject.id}
            href={`/subjects/${subject.slug}`}
            className="rounded-lg border border-zinc-200 px-4 py-6 text-center font-medium hover:border-zinc-400"
          >
            {subject.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
