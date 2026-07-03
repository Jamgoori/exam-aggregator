import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/admin/actions";

export default async function AnswersListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  let papersQuery = supabase
    .from("exam_papers")
    .select("id, title, year, question_count")
    .order("year", { ascending: false })
    .limit(50);
  if (q) papersQuery = papersQuery.ilike("title", `%${q}%`);

  const [{ data: papers }, { data: answered }] = await Promise.all([
    papersQuery,
    supabase.from("paper_answers").select("paper_id"),
  ]);

  const answeredSet = new Set((answered ?? []).map((a) => a.paper_id as string));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">CBT 정답 입력</h1>
        <form action={logout}>
          <button type="submit" className="text-sm text-zinc-500 underline">
            로그아웃
          </button>
        </form>
      </div>

      <Link href="/admin/upload" className="text-sm text-blue-600 underline">
        ← 문제 업로드로 돌아가기
      </Link>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="제목으로 검색"
          className="flex-1 rounded border border-zinc-300 px-3 py-2"
        />
        <button
          type="submit"
          className="rounded border border-zinc-300 px-4 py-2 text-sm"
        >
          검색
        </button>
      </form>

      <div className="flex flex-col divide-y divide-zinc-100 rounded border border-zinc-200">
        {(papers ?? []).length === 0 && (
          <p className="p-4 text-sm text-zinc-500">문제지가 없습니다.</p>
        )}
        {(papers ?? []).map((p) => (
          <Link
            key={p.id}
            href={`/admin/answers/${p.id}`}
            className="flex items-center justify-between gap-4 p-4 hover:bg-zinc-50"
          >
            <div>
              <p className="font-medium">{p.title}</p>
              <p className="text-xs text-zinc-500">
                {p.year}년{p.question_count ? ` · ${p.question_count}문항` : ""}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                answeredSet.has(p.id)
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-zinc-100 text-zinc-500"
              }`}
            >
              {answeredSet.has(p.id) ? "입력됨" : "미입력"}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
