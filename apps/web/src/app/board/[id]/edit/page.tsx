import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { BoardForm } from "@/components/board-form";
import { fetchBoardPost, getBoardViewer } from "@/lib/board";

export const metadata: Metadata = {
  title: "글 수정",
  robots: { index: false, follow: false },
};

export default async function EditBoardPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getBoardViewer();
  if (!viewer.loggedIn) {
    redirect(
      `/login?next=${encodeURIComponent(`/board/${id}/edit`)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const post = await fetchBoardPost(id, viewer);
  if (!post) notFound();

  // 수정 권한은 서버 액션이 최종적으로 다시 확인하지만, 화면부터 막아야 "고쳐
  // 썼는데 저장이 안 되는" 헛수고가 없다.
  if (!post.canEdit) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 py-24 text-center">
        <h1 className="text-lg font-bold">수정할 수 없는 글이에요</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          글은 작성한 본인만 수정할 수 있어요.
        </p>
        <Link
          href={`/board/${id}`}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          글로 돌아가기
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-6 pb-12 sm:pt-8">
      <div>
        <Link
          href={`/board/${id}`}
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 글로 돌아가기
        </Link>
        <h1 className="mt-2 text-2xl font-bold">글 수정</h1>
      </div>

      <BoardForm
        mode="edit"
        postId={post.id}
        isAdmin={viewer.isAdmin}
        initial={{
          title: post.title,
          category: post.category,
          contentHtml: post.contentHtml,
          isPinned: post.isPinned,
        }}
      />
    </div>
  );
}
