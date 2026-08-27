import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoticeForm } from "@/components/notice-form";
import { isNoticeAdmin } from "@/lib/notices";

export const metadata: Metadata = {
  title: "공지 작성",
  robots: { index: false, follow: false },
};

export default async function NewNoticePage() {
  // 글쓰기는 관리자만 — 실제 저장 권한은 RLS(is_admin)와 서버 액션이 다시
  // 검사하지만, 화면 자체도 관리자가 아니면 보여줄 이유가 없다.
  const canWrite = await isNoticeAdmin();
  if (!canWrite) redirect("/notices");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <Link
        href="/notices"
        className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
      >
        ← 공지사항
      </Link>

      <h1 className="text-2xl font-bold">공지 작성</h1>

      <NoticeForm />
    </div>
  );
}
