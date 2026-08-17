import Link from "next/link";
import type { Metadata } from "next";
import { Lock, MessageSquarePlus, Pin } from "lucide-react";
import { Pagination } from "@/components/pagination";
import {
  fetchSuggestionPage,
  getSuggestionViewer,
  SUGGESTIONS_PAGE_SIZE,
  type SuggestionListItem,
} from "@/lib/suggestions";

// 건의게시판 목록.
//
// 로그인 없이도 목록·공개글은 읽을 수 있게 두었다 — "이미 올라온 건의가 있는지"를
// 확인하려고 들어오는 사람이 대부분이라, 여기서 로그인부터 요구하면 같은 건의가
// 중복으로 쌓인다. 글쓰기만 로그인을 받는다(비밀글의 '본인'을 특정해야 한다).
export const metadata: Metadata = {
  title: "건의게시판",
  description: "공모아에 바라는 점을 남겨주세요. 비밀글로도 작성할 수 있습니다.",
  // 회원이 남긴 글이라 검색에 걸릴 이유가 없다(robots.ts 에서도 막는다).
  robots: { index: false, follow: false },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  // 오늘 글은 시:분으로 보여준다 — 게시판에서 "방금 올라온 글"이 눈에 띄어야 한다.
  return sameDay
    ? d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ko-KR", { year: "2-digit", month: "2-digit", day: "2-digit" });
}

// 공지·일반 글이 번호 칸만 다르고 나머지 줄 구성은 같아서 하나로 그린다.
// number 가 없으면(공지) 번호 대신 압정 배지를 보여주고, 줄 배경을 살짝 강조한다.
function SuggestionRow({ item, number }: { item: SuggestionListItem; number: number | null }) {
  return (
    <li>
      <Link
        href={`/suggestions/${item.id}`}
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
              공지
            </span>
          ) : (
            <span className="text-zinc-400 dark:text-zinc-500">{number}</span>
          )}
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {item.isPinned && (
            <Pin
              size={13}
              aria-label="공지"
              className="shrink-0 text-amber-600 sm:hidden dark:text-amber-400"
            />
          )}
          {item.isSecret && (
            <Lock
              size={13}
              aria-label="비밀글"
              className={
                item.readable
                  ? "shrink-0 text-blue-600 dark:text-blue-400"
                  : "shrink-0 text-zinc-400 dark:text-zinc-500"
              }
            />
          )}
          <span
            className={`truncate text-sm ${
              item.isPinned ? "font-semibold" : ""
            } ${item.readable ? "font-medium" : "text-zinc-400 italic dark:text-zinc-500"}`}
          >
            {item.title}
          </span>
          {item.isAnswered && (
            <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
              답변완료
            </span>
          )}
        </span>

        <span className="flex items-center gap-2 text-xs text-zinc-400 sm:contents dark:text-zinc-500">
          <span className="sm:w-24 sm:shrink-0 sm:truncate sm:text-center">
            {item.nickname}
          </span>
          <span className="sm:w-20 sm:shrink-0 sm:text-center">
            {formatDate(item.createdAt)}
          </span>
          <span className="sm:w-14 sm:shrink-0 sm:text-center">
            <span className="sm:hidden">조회 </span>
            {item.viewCount}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default async function SuggestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);

  const viewer = await getSuggestionViewer();
  const { items, pinnedItems, total, totalPages } = await fetchSuggestionPage(page, viewer);

  // 게시판 번호는 "전체(공지 제외)에서 몇 번째 글인가" — 최신순이라 위에서부터
  // 줄어든다. 공지는 이 번호 매김에서 빠진다(고정 자리를 따로 쓴다).
  const firstNumber = total - (page - 1) * SUGGESTIONS_PAGE_SIZE;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">건의게시판</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          불편한 점, 있었으면 하는 기능을 남겨주세요. 남에게 보이면 곤란한 내용은
          <span className="font-medium text-zinc-700 dark:text-zinc-200"> 비밀글</span>로
          작성할 수 있어요.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          전체 <span className="font-semibold text-zinc-700 dark:text-zinc-200">{total}</span>건
        </p>
        <Link
          href="/suggestions/new"
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <MessageSquarePlus size={16} />
          건의하기
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
        {/* 데스크톱: 표 머리글. 모바일에서는 줄마다 정보를 쌓아 보여준다. */}
        <div className="hidden bg-zinc-50 px-4 py-2.5 text-xs font-medium text-zinc-500 sm:flex dark:bg-zinc-800/60 dark:text-zinc-400">
          <span className="w-14 shrink-0 text-center">번호</span>
          <span className="min-w-0 flex-1">제목</span>
          <span className="w-24 shrink-0 text-center">작성자</span>
          <span className="w-20 shrink-0 text-center">작성일</span>
          <span className="w-14 shrink-0 text-center">조회</span>
        </div>

        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {pinnedItems.length === 0 && items.length === 0 && (
            <li className="px-4 py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
              아직 등록된 건의가 없어요. 첫 건의를 남겨보세요.
            </li>
          )}

          {pinnedItems.map((item) => (
            <SuggestionRow key={item.id} item={item} number={null} />
          ))}

          {items.map((item, i) => (
            <SuggestionRow key={item.id} item={item} number={firstNumber - i} />
          ))}
        </ul>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        params={{}}
        basePath="/suggestions"
      />
    </div>
  );
}
