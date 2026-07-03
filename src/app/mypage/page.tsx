import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquare, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import type { ExamPaper } from "@/lib/supabase/types";

// CBT 기능이 추가되면 "내 시험 기록"/"오답노트" 탭이 여기에 추가될 예정.
// 탭 단위 구조로 짜 둬서 그때 TABS 배열에 항목만 추가하면 되게 해둠.
const TABS = [
  { key: "bookmarks", label: "즐겨찾기" },
  { key: "comments", label: "내 댓글" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const next = tab ? `/mypage?tab=${encodeURIComponent(tab)}` : "/mypage";
    redirect(
      `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const activeTab: TabKey = TABS.some((t) => t.key === tab)
    ? (tab as TabKey)
    : "bookmarks";

  const nickname =
    (user.user_metadata?.nickname as string | undefined) ??
    user.email?.split("@")[0] ??
    "회원";

  const [{ data: bookmarkRows }, { data: commentRows }] = await Promise.all([
    supabase
      .from("bookmarks")
      .select("id, created_at, exam_papers(*, subjects(*), exam_types(*))")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("comments")
      .select("id, content, created_at, updated_at, exam_papers(id, title)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const bookmarkedPapers = (
    (bookmarkRows ?? []) as unknown as { exam_papers: ExamPaper | null }[]
  )
    .map((r) => r.exam_papers)
    .filter((p): p is ExamPaper => p !== null);

  const myComments = (commentRows ?? []) as unknown as {
    id: string;
    content: string;
    created_at: string;
    updated_at: string | null;
    exam_papers: { id: string; title: string } | null;
  }[];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-12">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-blue-600">
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">{nickname}님의 마이페이지</h1>
        <p className="mt-1 text-sm text-zinc-500">{user.email}</p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/mypage?tab=${t.key}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              activeTab === t.key
                ? "bg-blue-600 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {activeTab === "bookmarks" && (
        <section className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Star size={18} className="text-amber-400" />
            즐겨찾기한 문제 ({bookmarkedPapers.length})
          </h2>
          {bookmarkedPapers.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-500">
              아직 즐겨찾기한 문제가 없어요. 문제 상세 페이지에서 북마크 아이콘을
              눌러보세요.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {bookmarkedPapers.map((paper) => (
                <ExamCard key={paper.id} paper={paper} />
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "comments" && (
        <section className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MessageSquare size={18} className="text-blue-500" />내 댓글 (
            {myComments.length})
          </h2>
          {myComments.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-500">
              아직 작성한 댓글이 없어요.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-zinc-100">
              {myComments.map((c) => (
                <div key={c.id} className="flex flex-col gap-1 py-4">
                  <div className="flex items-center justify-between gap-2">
                    {c.exam_papers ? (
                      <Link
                        href={`/papers/${c.exam_papers.id}`}
                        className="text-sm font-medium text-blue-600 hover:underline"
                      >
                        {c.exam_papers.title}
                      </Link>
                    ) : (
                      <span className="text-sm text-zinc-400">
                        삭제된 문제
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-zinc-400">
                      {new Date(c.created_at).toLocaleDateString("ko-KR")}
                      {c.updated_at ? " (수정됨)" : ""}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-zinc-700">
                    {c.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
