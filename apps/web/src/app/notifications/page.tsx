import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Bell } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { NotificationList } from "@/components/notification-list";
import { getSessionUser } from "@/lib/supabase/session";
import { fetchNotifications, NOTIFICATIONS_PAGE_SIZE } from "@/lib/notifications";

// 알림 전체보기. 헤더의 종은 최근 8건만 보여주므로, 그보다 예전 것을 찾거나
// 한꺼번에 정리하려는 사람이 오는 자리다.
export const metadata: Metadata = {
  title: "알림",
  // 개인에게만 뜻이 있는 화면이라 검색에 걸릴 이유가 없다.
  robots: { index: false, follow: false },
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const { user } = await getSessionUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent("/notifications")}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const { items, total, unread } = await fetchNotifications(user.id, {
    limit: NOTIFICATIONS_PAGE_SIZE,
    offset: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <div className="flex flex-col gap-1">
        <Link
          href="/mypage"
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 마이페이지
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
            <Bell size={18} />
          </span>
          <div>
            <h1 className="text-2xl font-bold">알림</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {unread > 0 ? `안 읽은 알림 ${unread}개` : "모두 읽었어요"}
            </p>
          </div>
        </div>
      </div>

      <NotificationList items={items} unread={unread} />

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        params={{}}
        basePath="/notifications"
      />
    </div>
  );
}
