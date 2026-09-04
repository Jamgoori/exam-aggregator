"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";
import {
  loadNotificationFeed,
  loadUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/app/notifications/actions";
import {
  notificationMessage,
  relativeTimeLabel,
  unreadBadgeLabel,
  type NotificationItem,
} from "@gongmoa/core";

// 헤더의 알림 종.
//
// 이 컴포넌트는 레이아웃에 살아남아 페이지 이동과 무관하게 상태를 들고 있다.
// 그래서 데이터를 서버 컴포넌트로 내려받지 않고 서버 액션으로 직접 가져온다:
//   · 마운트 직후 안 읽은 개수 한 번
//   · 그 뒤 60초마다 개수만 (탭이 보일 때만 — 백그라운드 탭이 서버를 두드리지 않게)
//   · 종을 열 때 목록까지
// 실시간 푸시(Realtime)를 쓰지 않는 이유는, 알림이 1분 늦게 와도 아무 문제가 없는
// 종류의 기능인데 연결을 하나 상시로 잡고 있는 비용이 그보다 크기 때문이다.
const POLL_INTERVAL_MS = 60_000;

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const refreshCount = useCallback(() => {
    loadUnreadCount()
      .then(setUnread)
      .catch(() => {
        // 개수 조회 실패는 조용히 넘긴다 — 다음 주기에 다시 물어본다.
      });
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refreshCount();
    }, POLL_INTERVAL_MS);
    // 다른 탭에서 알림을 읽고 돌아왔을 수 있으니 탭이 다시 보일 때도 한 번 맞춘다.
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      // 사라진 패널에 포커스를 남기지 않는다(계정 메뉴와 같은 처리).
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    // 열 때마다 새로 읽는다 — 열어둔 채 몇 분이 지난 뒤 다시 열었을 때 옛 목록이
    // 그대로 남아 있으면 "알림이 안 온다"로 읽힌다.
    startTransition(async () => {
      const feed = await loadNotificationFeed();
      setItems(feed.items);
      setUnread(feed.unread);
    });
  }

  function handleOpenItem(item: NotificationItem) {
    setOpen(false);
    if (!item.isRead) {
      setItems((prev) =>
        prev ? prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)) : prev,
      );
      setUnread((n) => Math.max(0, n - 1));
      // 읽음 처리는 이동을 막지 않는다(결과를 기다리지 않는다).
      void markNotificationRead(item.id);
    }
  }

  function handleMarkAll() {
    setItems((prev) => (prev ? prev.map((n) => ({ ...n, isRead: true })) : prev));
    setUnread(0);
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }

  const badge = unreadBadgeLabel(unread);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={unread > 0 ? `알림 ${unread}개` : "알림"}
        className={`relative flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none ${
          open
            ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        }`}
      >
        <Bell size={19} />
        {badge && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-zinc-950">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div
          id={panelId}
          className="animate-modal-panel-in absolute top-full right-0 z-50 mt-2 flex max-h-[70vh] w-[min(21rem,calc(100vw-2rem))] origin-top-right flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40"
        >
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
            <p className="text-sm font-bold">알림</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={handleMarkAll}
                className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400"
              >
                <Check size={12} />
                모두 읽음
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {items === null && pending && (
              <div className="flex flex-col gap-2 p-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="skeleton h-12 rounded-xl" />
                ))}
              </div>
            )}

            {items !== null && items.length === 0 && (
              <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
                <Bell size={22} className="text-zinc-300 dark:text-zinc-600" />
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  아직 받은 알림이 없어요.
                </p>
                <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  내 글에 댓글이 달리면 여기로 알려드려요.
                </p>
              </div>
            )}

            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {(items ?? []).map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.link}
                    onClick={() => handleOpenItem(item)}
                    className={`flex flex-col gap-0.5 px-4 py-3 transition-colors ${
                      item.isRead
                        ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                        : "bg-blue-50/50 hover:bg-blue-50 dark:bg-blue-950/20 dark:hover:bg-blue-950/30"
                    }`}
                  >
                    <p className="text-[13px] leading-snug">
                      <span className="font-semibold">{item.actorNickname}</span>
                      <span className="text-zinc-600 dark:text-zinc-300">
                        {notificationMessage(item.type)}
                      </span>
                    </p>
                    {item.preview && (
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {item.preview}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
                      <span className="max-w-[10rem] truncate">{item.title}</span>
                      <span aria-hidden>·</span>
                      <span>{relativeTimeLabel(item.createdAt)}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="border-t border-zinc-100 px-4 py-2.5 text-center text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50/60 dark:border-zinc-800 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            알림 전체보기
          </Link>
        </div>
      )}
    </div>
  );
}
