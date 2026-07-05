import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquare, Star, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ExamCard } from "@/components/exam-card";
import { updateNickname } from "@/app/actions";
import { NICKNAME_MAX, NICKNAME_MIN } from "@/lib/nickname";
import { formatDuration } from "@/lib/format";
import type { ExamPaper } from "@/lib/supabase/types";

// 오답노트는 문항별 정답/오답 이미지를 모아 보여줘야 해서 더 큰 작업이라 별도로 남겨둠.
const TABS = [
  { key: "bookmarks", label: "즐겨찾기" },
  { key: "comments", label: "내 댓글" },
  { key: "history", label: "내 시험 기록" },
  { key: "account", label: "내 정보" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; error?: string; message?: string }>;
}) {
  const { tab, error, message } = await searchParams;
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

  const [{ data: bookmarkRows }, { data: commentRows }, { data: attemptRows }] =
    await Promise.all([
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
      supabase
        .from("cbt_attempts")
        .select(
          "id, score, total_questions, duration_seconds, created_at, exam_papers(id, title, subjects(*), exam_types(*))",
        )
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

  const myAttempts = (attemptRows ?? []) as unknown as {
    id: string;
    score: number;
    total_questions: number;
    duration_seconds: number | null;
    created_at: string;
    exam_papers: (Pick<ExamPaper, "id" | "title"> & {
      subjects?: ExamPaper["subjects"];
      exam_types?: ExamPaper["exam_types"];
    }) | null;
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

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3">
          <span className="text-xs text-zinc-500">즐겨찾기</span>
          <span className="text-xl font-semibold">{bookmarkedPapers.length}</span>
        </div>
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3">
          <span className="text-xs text-zinc-500">내 댓글</span>
          <span className="text-xl font-semibold">{myComments.length}</span>
        </div>
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3">
          <span className="text-xs text-zinc-500">CBT 응시</span>
          <span className="text-xl font-semibold">{myAttempts.length}</span>
        </div>
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

      {activeTab === "history" && (
        <section className="flex flex-col gap-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Trophy size={18} className="text-amber-500" />
            내 시험 기록 ({myAttempts.length})
          </h2>
          {myAttempts.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-500">
              아직 CBT로 풀어본 문제가 없어요. 문제 상세 페이지에서 온라인 풀기를
              눌러보세요.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-zinc-100">
              {myAttempts.map((a) => {
                const pct =
                  a.total_questions > 0
                    ? Math.round((a.score / a.total_questions) * 100)
                    : 0;
                return (
                  <div
                    key={a.id}
                    className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex flex-col gap-0.5">
                      {a.exam_papers ? (
                        <Link
                          href={`/papers/${a.exam_papers.id}`}
                          className="text-sm font-medium text-blue-600 hover:underline"
                        >
                          {a.exam_papers.title}
                        </Link>
                      ) : (
                        <span className="text-sm text-zinc-400">삭제된 문제</span>
                      )}
                      <span className="text-xs text-zinc-400">
                        {new Date(a.created_at).toLocaleDateString("ko-KR")}
                        {a.duration_seconds != null &&
                          ` · ${formatDuration(a.duration_seconds)}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-semibold">
                        {a.score} / {a.total_questions}
                      </span>
                      <span className="text-xs text-zinc-400">({pct}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {activeTab === "account" && (
        <section className="flex max-w-sm flex-col gap-6">
          <h2 className="text-lg font-semibold">내 정보</h2>

          <form action={updateNickname} className="flex flex-col gap-1">
            <label htmlFor="nickname" className="text-sm text-zinc-600">
              닉네임
            </label>
            <input
              id="nickname"
              name="nickname"
              defaultValue={nickname}
              required
              minLength={NICKNAME_MIN}
              maxLength={NICKNAME_MAX}
              className="rounded border border-zinc-300 px-3 py-2"
            />
            <p className="mb-2 text-xs text-zinc-400">
              {NICKNAME_MIN}~{NICKNAME_MAX}자로 입력해주세요.
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {message && <p className="text-sm text-green-600">{message}</p>}
            <button
              type="submit"
              className="mt-2 self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              저장
            </button>
          </form>

          <div className="flex flex-col gap-1 border-t border-zinc-100 pt-4">
            <span className="text-sm text-zinc-500">이메일</span>
            <span className="text-sm text-zinc-700">{user.email}</span>
          </div>
        </section>
      )}
    </div>
  );
}
