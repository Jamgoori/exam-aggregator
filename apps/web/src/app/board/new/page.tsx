import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { BoardForm } from "@/components/board-form";
import { getBoardViewer } from "@/lib/board";

export const metadata: Metadata = {
  title: "글쓰기",
  robots: { index: false, follow: false },
};

export default async function NewBoardPostPage() {
  const viewer = await getBoardViewer();
  // 목록·본문은 비회원도 보지만 글쓰기는 로그인이 필요하다(작성자를 특정할 수 있어야
  // 수정·삭제 권한을 줄 수 있다).
  if (!viewer.loggedIn) {
    redirect(
      `/login?next=${encodeURIComponent("/board/new")}&error=${encodeURIComponent("로그인 후 글을 쓸 수 있어요")}`,
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pt-6 pb-12 sm:pt-8">
      <div>
        <Link
          href="/board"
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 자유게시판
        </Link>
        <h1 className="mt-2 text-2xl font-bold">글쓰기</h1>
      </div>

      <BoardForm mode="create" isAdmin={viewer.isAdmin} />
    </div>
  );
}
