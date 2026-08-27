import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { NoticeForm } from "@/components/notice-form";
import { fetchNotice, isNoticeAdmin } from "@/lib/notices";

export const metadata: Metadata = {
  title: "공지 수정",
  robots: { index: false, follow: false },
};

export default async function EditNoticePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 수정 권한은 서버 액션이 다시 검사한다 — 여기 검사는 화면을 안 보여주기 위한 것.
  const canWrite = await isNoticeAdmin();
  if (!canWrite) redirect(`/notices/${id}`);

  const notice = await fetchNotice(id);
  if (!notice) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <Link
        href={`/notices/${id}`}
        className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
      >
        ← 돌아가기
      </Link>

      <h1 className="text-2xl font-bold">공지 수정</h1>

      <NoticeForm
        notice={{
          id: notice.id,
          title: notice.title,
          content: notice.content,
          isPinned: notice.isPinned,
        }}
      />
    </div>
  );
}
