import Link from "next/link";
import type { Metadata } from "next";
import { Eye, Heart, MessageSquare, PencilLine, Pin } from "lucide-react";
import { Pagination } from "@/components/pagination";
import { Avatar } from "@/components/user-menu";
import { BoardSearch } from "@/components/board-search";
import { fetchBoardPage, type BoardListItem } from "@/lib/board";
import {
  BOARD_CATEGORIES,
  boardCategoryLabel,
  kstDayKey,
  KST_TIME_ZONE,
} from "@gongmoa/core";
import { absoluteUrl } from "@/lib/site-url";

// 자유게시판 목록.
//
// 비회원도 읽을 수 있게 열어둔다 — 커뮤니티는 "먼저 구경하고 그 다음 가입"이
// 자연스러운 순서라, 목록부터 로그인을 요구하면 아무도 두 번째 화면을 못 본다.
// 글쓰기·댓글·좋아요에서만 로그인을 받는다.
export const metadata: Metadata = {
  title: "자유게시판",
  description:
    "공무원 수험생끼리 공부·시험·일상 이야기를 나누는 자유게시판. 질문과 정보, 합격수기를 남겨보세요.",
  alternates: { canonical: absoluteUrl("/board") },
};

// 시각은 언제나 한국 시간으로 그린다. 이 페이지는 서버 컴포넌트고 서버는 UTC 로
// 돌기 때문에, timeZone 을 빼면 방금 올린 글이 9시간 전으로 보인다(core 의
// KST_TIME_ZONE 주석). "오늘인가" 판정도 같은 이유로 KST 날짜 키를 비교한다.
function formatDate(iso: string) {
  const d = new Date(iso);
  const sameDay = kstDayKey(d) === kstDayKey(new Date());
  // 오늘 글은 시:분으로 — 게시판에서 "방금 올라온 글"이 눈에 띄어야 한다.
  return sameDay
    ? d.toLocaleTimeString("ko-KR", {
        timeZone: KST_TIME_ZONE,
        hour: "2-digit",
        minute: "2-digit",
      })
    : d.toLocaleDateString("ko-KR", {
        timeZone: KST_TIME_ZONE,
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
      });
}

const CATEGORY_STYLE: Record<string, string> = {
  free: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  question: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
  review: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
};

// 목록 한 줄. 표가 아니라 카드로 그리는 이유: 본문 미리보기와 썸네일이 있어야
// "들어가 볼 만한 글인지"가 제목 한 줄보다 훨씬 빨리 판단된다(요즘 커뮤니티의 기본).
function PostRow({ item }: { item: BoardListItem }) {
  return (
    <li>
      <Link
        href={`/board/${item.id}`}
        className={`flex gap-3 px-4 py-4 transition-colors ${
          item.isPinned
            ? "bg-amber-50/40 hover:bg-amber-50/70 dark:bg-amber-950/10 dark:hover:bg-amber-950/20"
            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
        }`}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-1.5">
            {item.isPinned ? (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                <Pin size={10} />
                공지
              </span>
            ) : (
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  CATEGORY_STYLE[item.category] ?? CATEGORY_STYLE.free
                }`}
              >
                {boardCategoryLabel(item.category)}
              </span>
            )}
            <h2 className="truncate text-[15px] font-semibold">{item.title}</h2>
          </div>

          {item.preview && (
            <p className="line-clamp-2 text-[13px] leading-5 text-zinc-500 dark:text-zinc-400">
              {item.preview}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400 dark:text-zinc-500">
            <span className="flex items-center gap-1.5">
              <Avatar nickname={item.nickname} avatarUrl={item.avatarUrl} size="sm" />
              <span className="font-medium text-zinc-500 dark:text-zinc-400">
                {item.nickname}
              </span>
            </span>
            <span>{formatDate(item.createdAt)}</span>
            <span className="flex items-center gap-0.5">
              <Eye size={12} />
              {item.viewCount}
            </span>
            {item.commentCount > 0 && (
              <span className="flex items-center gap-0.5 font-medium text-blue-600 dark:text-blue-400">
                <MessageSquare size={12} />
                {item.commentCount}
              </span>
            )}
            {item.likeCount > 0 && (
              <span className="flex items-center gap-0.5 text-rose-500">
                <Heart size={12} />
                {item.likeCount}
              </span>
            )}
          </div>
        </div>

        {item.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-16 w-16 shrink-0 rounded-xl bg-zinc-100 object-cover sm:h-20 sm:w-20 dark:bg-zinc-800"
          />
        )}
      </Link>
    </li>
  );
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string; q?: string }>;
}) {
  const { page: pageParam, category, q } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const keyword = (q ?? "").trim();

  const { items, pinnedItems, total, totalPages } = await fetchBoardPage({
    page,
    category,
    query: keyword,
  });

  // 말머리 탭·검색을 유지한 채 페이지만 넘기게 파라미터를 그대로 넘겨준다.
  const params = { category: category || undefined, q: keyword || undefined };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pt-6 pb-12 sm:pt-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">자유게시판</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          같은 시험을 준비하는 사람들과 이야기를 나눠보세요. 공부법·시험 정보·합격수기
          무엇이든 좋아요.
        </p>
      </div>

      {/* 말머리 탭. 현재 탭은 초록(브랜드색)으로 채워 어디를 보고 있는지 한눈에 든다. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-1">
        <div className="flex gap-1.5">
          <CategoryTab href="/board" label="전체" active={!category} />
          {BOARD_CATEGORIES.map((c) => (
            <CategoryTab
              key={c.slug}
              href={`/board?category=${c.slug}`}
              label={c.label}
              active={category === c.slug}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <BoardSearch initialQuery={keyword} category={category} />
        <Link
          href="/board/new"
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
        >
          <PencilLine size={16} />
          글쓰기
        </Link>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {keyword ? (
          <>
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">
              &ldquo;{keyword}&rdquo;
            </span>{" "}
            검색 결과 {total}건
          </>
        ) : (
          <>
            전체{" "}
            <span className="font-semibold text-zinc-700 dark:text-zinc-200">{total}</span>건
          </>
        )}
      </p>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {pinnedItems.length === 0 && items.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-4 py-16 text-center">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {keyword ? "검색 결과가 없어요." : "아직 올라온 글이 없어요."}
              </p>
              {!keyword && (
                <Link
                  href="/board/new"
                  className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                >
                  첫 글을 남겨보세요 →
                </Link>
              )}
            </li>
          )}

          {pinnedItems.map((item) => (
            <PostRow key={item.id} item={item} />
          ))}
          {items.map((item) => (
            <PostRow key={item.id} item={item} />
          ))}
        </ul>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        params={params}
        basePath="/board"
      />
    </div>
  );
}

function CategoryTab({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      }`}
    >
      {label}
    </Link>
  );
}
