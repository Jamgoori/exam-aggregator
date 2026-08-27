"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Pin } from "lucide-react";
import { createNotice, updateNotice } from "@/app/notices/actions";
import { NOTICE_CONTENT_MAX, NOTICE_TITLE_MAX } from "@gongmoa/core";

// 공지 작성/수정 폼. 이 화면은 애초에 관리자만 들어올 수 있으므로(new/edit
// page.tsx가 막는다) suggestions 폼과 달리 권한에 따라 숨길 입력이 없다.
export function NoticeForm({
  notice,
}: {
  notice?: { id: string; title: string; content: string; isPinned: boolean };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(notice?.title ?? "");
  const [content, setContent] = useState(notice?.content ?? "");
  const [isPinned, setIsPinned] = useState(notice?.isPinned ?? false);

  const editing = notice !== undefined;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateNotice({ id: notice.id, title, content, isPinned })
        : await createNotice({ title, content, isPinned });

      if (result.error) {
        setError(result.error);
        return;
      }
      router.replace(`/notices/${result.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="notice-title" className="text-sm font-medium">
          제목
        </label>
        <input
          id="notice-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={NOTICE_TITLE_MAX}
          required
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notice-content" className="text-sm font-medium">
          내용
        </label>
        <textarea
          id="notice-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={NOTICE_CONTENT_MAX}
          required
          rows={14}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <p className="self-end text-xs text-zinc-400 dark:text-zinc-500">
          {content.length}/{NOTICE_CONTENT_MAX}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 px-3.5 py-3 transition-colors hover:border-amber-300 has-checked:border-amber-400 has-checked:bg-amber-50/60 dark:border-zinc-700 dark:hover:border-amber-800 dark:has-checked:border-amber-800 dark:has-checked:bg-amber-950/20">
        <input
          type="checkbox"
          checked={isPinned}
          onChange={(e) => setIsPinned(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-amber-600"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Pin size={14} className="shrink-0 text-amber-600 dark:text-amber-400" />
            상단 고정
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
            체크하면 목록 맨 위에 항상 고정돼요.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Link
          href={editing ? `/notices/${notice.id}` : "/notices"}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "저장 중..." : editing ? "수정하기" : "등록하기"}
        </button>
      </div>
    </form>
  );
}
