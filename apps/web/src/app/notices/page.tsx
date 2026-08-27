import Link from "next/link";
import type { Metadata } from "next";
import { Megaphone, Pin, SquarePen } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { fetchNoticePage, isNoticeAdmin, NOTICES_PAGE_SIZE, type NoticeListItem } from "@/lib/notices";

// 공지사항 게시판 목록. 회원가입 없이도 전부 읽을 수 있는 공개 게시판이라
// 검색 색인도 막지 않는다(robots.ts에 별도 disallow 없음, suggestions와 다른 점).
export const metadata: Metadata = {
  title: "공지사항",
  description: "공모아의 새 소식과 안내를 확인하세요.",
  // ?page= 로 갈라지는 목록이라 정본을 1페이지로 모은다. 공지 본문은 각 상세
  // 페이지가 자기 주소를 정본으로 들고 있고 사이트맵에도 따로 실리므로, 2페이지
  // 이후를 색인에서 접어도 발견 경로가 끊기지 않는다.
  alternates: { canonical: "/notices" },
  openGraph: { url: "/notices", title: "공지사항" },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

function NoticeRow({ item, number }: { item: NoticeListItem; number: number | null }) {
  return (
    <li>
      <Link
        href={`/notices/${item.id}`}
        className={`flex flex-col gap-1 px-4 py-3 transition-colors sm:flex-row sm:items-center sm:gap-0 ${
          item.isPinned
            ? "bg-amber-50/50 hover:bg-amber-50 dark:bg-amber-950/10 dark:hover:bg-amber-950/20"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
        }`}
      >
        <span className="hidden w-14 shrink-0 items-center justify-center text-xs sm:flex">
          {item.isPinned ? (
            <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              <Pin size={10} />
              고정
            </span>
          ) : (
            <span className="text-zinc-400 dark:text-zinc-500">{number}</span>
          )}
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {item.isPinned && (
            <Pin
              size={13}
              aria-label="고정"
              className="shrink-0 text-amber-600 sm:hidden dark:text-amber-400"
            />
          )}
          <span
            className={`truncate text-sm ${item.isPinned ? "font-semibold" : "font-medium"}`}
          >
            {item.title}
          </span>
        </span>

        <span className="flex items-center gap-2 text-xs text-zinc-400 sm:contents dark:text-zinc-500">
          <span className="sm:w-20 sm:shrink-0 sm:text-center">{formatDate(item.createdAt)}</span>
          <span className="sm:w-14 sm:shrink-0 sm:text-center">
            <span className="sm:hidden">조회 </span>
            {item.viewCount}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const [{ items, pinnedItems, total, totalPages }, canWrite] = await Promise.all([
    fetchNoticePage(page),
    isNoticeAdmin(),
  ]);

  // 공지 번호는 "전체(고정 제외)에서 몇 번째 글인가" — 최신순이라 위에서부터 줄어든다.
  const firstNumber = total - (page - 1) * NOTICES_PAGE_SIZE;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Megaphone size={22} className="text-blue-600 dark:text-blue-400" />
          공지사항
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          공모아의 새 소식과 안내를 확인하세요.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          전체 <span className="font-semibold text-zinc-700 dark:text-zinc-200">{total}</span>건
        </p>
        {canWrite && (
          <Link
            href="/notices/new"
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <SquarePen size={16} />
            글쓰기
          </Link>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
        <div className="hidden bg-zinc-50 px-4 py-2.5 text-xs font-medium text-zinc-500 sm:flex dark:bg-zinc-800/60 dark:text-zinc-400">
          <span className="w-14 shrink-0 text-center">번호</span>
          <span className="min-w-0 flex-1">제목</span>
          <span className="w-20 shrink-0 text-center">작성일</span>
          <span className="w-14 shrink-0 text-center">조회</span>
        </div>

        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {pinnedItems.length === 0 && items.length === 0 && (
            <li className="px-4 py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              아직 등록된 공지가 없어요.
            </li>
          )}

          {pinnedItems.map((item) => (
            <NoticeRow key={item.id} item={item} number={null} />
          ))}

          {items.map((item, i) => (
            <NoticeRow key={item.id} item={item} number={firstNumber - i} />
          ))}
        </ul>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        params={{}}
        basePath="/notices"
      />
    </div>
  );
}
