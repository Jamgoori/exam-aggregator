import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Pin } from "lucide-react";
import { NoticeComments } from "@/components/notice-comments";
import { NoticeDeleteButton } from "@/components/notice-delete-button";
import { countNoticeView, fetchNotice, fetchNoticeComments, getNoticeViewer } from "@/lib/notices";
import { KST_TIME_ZONE } from "@gongmoa/core";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const notice = await fetchNotice(id);
  return { title: notice ? notice.title : "공지사항" };
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function NoticeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const notice = await fetchNotice(id);
  if (!notice) notFound();

  const viewer = await getNoticeViewer();
  const [, comments] = await Promise.all([
    countNoticeView(id),
    fetchNoticeComments(id, viewer),
  ]);
  const canWrite = viewer.isAdmin;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <Link
        href="/notices"
        className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
      >
        ← 공지사항
      </Link>

      <article className="flex flex-col gap-4">
        <header className="flex flex-col gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-700">
          {notice.isPinned && (
            <span className="flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              <Pin size={11} />
              고정
            </span>
          )}

          <h1 className="text-xl font-bold break-words">{notice.title}</h1>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 dark:text-zinc-500">
            <span>{formatDateTime(notice.createdAt)}</span>
            <span>조회 {notice.viewCount}</span>
          </div>
        </header>

        <p className="min-h-24 text-sm leading-7 whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
          {notice.content}
        </p>

        {canWrite && (
          <div className="flex items-center justify-end gap-2">
            <Link
              href={`/notices/${notice.id}/edit`}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:text-blue-400"
            >
              수정
            </Link>
            <NoticeDeleteButton id={notice.id} />
          </div>
        )}
      </article>

      <div className="border-t border-zinc-200 pt-6 dark:border-zinc-700">
        <NoticeComments noticeId={notice.id} comments={comments} loggedIn={viewer.loggedIn} />
      </div>
    </div>
  );
}
