import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/admin/actions";
import { getCbtAvailability } from "@/lib/cbt-availability";

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

  // 로그인만 한 일반 계정이 관리자 화면을 열어보지 못하게 막는다 (데이터 쓰기는
  // 어차피 RLS가 막지만, 관리자 UI 자체를 노출할 이유가 없다).
  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) {
    redirect("/");
  }

  let papersQuery = supabase
    .from("exam_papers")
    .select("id, title, year, question_count")
    .order("year", { ascending: false })
    .limit(50);
  if (q) papersQuery = papersQuery.ilike("title", `%${q}%`);

  const { data: papers } = await papersQuery;

  // "정답 있음" 판정은 화면에 보이는 50장에 대해서만 묻는다.
  //
  // 예전에는 paper_answers 전체를 받아 Set 에 담았는데, PostgREST 응답은 1000행에서
  // 조용히 잘린다. paper_answers 는 이미 1000건을 넘었고(lib/cbt-availability.ts 의
  // 같은 사고 기록 참고), 그래서 1000번째 뒤의 문제지는 정답이 멀쩡히 등록돼 있는데도
  // 이 목록에서 "미입력" 으로 보였다. 표시가 틀리는 문제다.
  //
  // 어차피 화면에 그릴 건 50장뿐이니 그 id 만 넘긴다 — 잘릴 일이 없어지고 전송량도
  // 수천 행에서 50행 이하로 준다. getCbtAvailability 가 쓰는 has_cbt_answers_bulk 는
  // 정확히 이 용도로 만들어 둔 함수다(정답 내용은 안 나오고 존재 여부만 온다).
  const answeredSet = await getCbtAvailability(
    supabase,
    (papers ?? []).map((p) => p.id as string),
  );

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">CBT 정답 입력</h1>
        <form action={logout}>
          <button type="submit" className="text-sm text-zinc-500 underline dark:text-zinc-500">
            로그아웃
          </button>
        </form>
      </div>

      <Link href="/admin/upload" className="text-sm text-blue-600 underline dark:text-blue-400">
        ← 문제 업로드로 돌아가기
      </Link>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="제목으로 검색"
          className="flex-1 rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
        />
        <button
          type="submit"
          className="rounded border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
        >
          검색
        </button>
      </form>

      <div className="flex flex-col divide-y divide-zinc-100 rounded border border-zinc-200 dark:divide-zinc-700 dark:border-zinc-700">
        {(papers ?? []).length === 0 && (
          <p className="p-4 text-sm text-zinc-500 dark:text-zinc-500">문제지가 없습니다.</p>
        )}
        {(papers ?? []).map((p) => (
          <Link
            key={p.id}
            href={`/admin/answers/${p.id}`}
            className="flex items-center justify-between gap-4 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
          >
            <div>
              <p className="font-medium">{p.title}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                {p.year}년{p.question_count ? ` · ${p.question_count}문항` : ""}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                answeredSet.has(p.id)
                  ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
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
