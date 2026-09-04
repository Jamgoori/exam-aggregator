"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, X } from "lucide-react";
import {
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/notifications/actions";
import {
  notificationMessage,
  relativeTimeLabel,
  type NotificationItem,
} from "@gongmoa/core";

// /notifications 의 목록. 헤더 종의 드롭다운과 같은 줄 구성을 쓰되, 여기서는
// 한 건씩 지울 수 있다(종에서는 자리가 없어 넣지 않았다).
export function NotificationList({
  items: initialItems,
  unread,
}: {
  items: NotificationItem[];
  unread: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [pending, startTransition] = useTransition();

  function handleOpen(item: NotificationItem) {
    if (item.isRead) return;
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
    void markNotificationRead(item.id);
  }

  function handleDelete(id: string) {
    setItems((prev) => prev.filter((n) => n.id !== id));
    startTransition(async () => {
      await deleteNotification(id);
      router.refresh();
    });
  }

  function handleMarkAll() {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-200 px-4 py-16 text-center dark:border-zinc-700">
        <Bell size={26} className="text-zinc-300 dark:text-zinc-600" />
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
          아직 받은 알림이 없어요.
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          내 글에 댓글이 달리거나 내 댓글에 답글이 달리면 여기로 알려드려요.
        </p>
        <Link
          href="/board"
          className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          자유게시판 둘러보기
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {unread > 0 && (
        <button
          type="button"
          onClick={handleMarkAll}
          disabled={pending}
          className="flex items-center gap-1 self-end rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:text-blue-400"
        >
          <Check size={13} />
          모두 읽음으로 표시
        </button>
      )}

      <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-700">
        {items.map((item) => (
          <li key={item.id} className="relative">
            <Link
              href={item.link}
              onClick={() => handleOpen(item)}
              className={`flex flex-col gap-1 px-4 py-3.5 pr-12 transition-colors ${
                item.isRead
                  ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  : "bg-blue-50/50 hover:bg-blue-50 dark:bg-blue-950/20 dark:hover:bg-blue-950/30"
              }`}
            >
              <p className="flex items-center gap-1.5 text-sm leading-snug">
                {!item.isRead && (
                  <span
                    aria-label="안 읽음"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
                  />
                )}
                <span className="font-semibold">{item.actorNickname}</span>
                <span className="text-zinc-600 dark:text-zinc-300">
                  {notificationMessage(item.type)}
                </span>
              </p>
              {item.preview && (
                <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {item.preview}
                </p>
              )}
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                <span className="max-w-[14rem] truncate">{item.title}</span>
                <span aria-hidden>·</span>
                <span>{relativeTimeLabel(item.createdAt)}</span>
              </div>
            </Link>

            <button
              type="button"
              onClick={() => handleDelete(item.id)}
              aria-label="알림 삭제"
              className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center rounded-full text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            >
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
