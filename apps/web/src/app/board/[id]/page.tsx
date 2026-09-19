import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Eye, MessageSquare, Pin } from "lucide-react";
import { Avatar } from "@/components/user-menu";
import { BoardComments } from "@/components/board-comments";
import {
  BoardDeleteButton,
  BoardLikeButton,
  BoardMoreMenu,
  BoardShareButton,
} from "@/components/board-post-actions";
import { RichTextContent } from "@/components/rich-text-content";
import { ScrollToHash } from "@/components/scroll-to-hash";
import {
  countBoardView,
  fetchBoardComments,
  fetchBoardPost,
  getBoardPostMeta,
  getBoardViewer,
  getRecentBoardPostIds,
  hasLikedBoardPost,
} from "@/lib/board";
import { absoluteUrl } from "@/lib/site-url";
import { boardCategoryLabel, KST_TIME_ZONE } from "@gongmoa/core";

// 글 상세. 본문 자체는 로그인 여부에 따라 달라지므로(수정·삭제 버튼, 좋아요 상태)
// 캐시하지 않지만, **<head> 만은 셸에 미리 박아야 한다**.
//
// 주소를 하나도 알려주지 않으면 Next 는 모든 글에 공용 fallback 셸을 돌려쓰고, 그
// 셸에는 generateMetadata 를 돌릴 수 없어 <title>·canonical 이 없다 — 크롤러는 그
// 셸을 그대로 받는다(AGENTS.md 의 "검색 색인(SEO)" 항목, papers/[id] 주석의 실측).
// 그래서 최신 글 주소를 여기서 알려주고, generateMetadata 가 기다리는 조회는 전부
// 'use cache' + 공개 클라이언트로 둔다(lib/board.ts 의 getBoardPostMeta).
//
// 목록이 비어 있을 때도 **한 건은 반드시 돌려줘야 한다** — Cache Components 는 빈
// 배열을 빌드 에러로 막는다("all generateStaticParams functions must return at least
// one result"). 글이 하나도 없는 새 게시판이 정확히 그 경우라, 없을 때는 존재하지
// 않는 주소 하나를 넣어 404 셸을 굽는다(그 주소로 들어오면 평소처럼 404 다).
const EMPTY_BOARD_PLACEHOLDER_ID = "no-posts-yet";

export async function generateStaticParams() {
  const ids = await getRecentBoardPostIds();
  return ids.length > 0
    ? ids.map((id) => ({ id }))
    : [{ id: EMPTY_BOARD_PLACEHOLDER_ID }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const meta = await getBoardPostMeta(id);
  if (!meta) return { title: "자유게시판" };

  const canonical = absoluteUrl(`/board/${id}`);
  return {
    title: meta.title,
    description: meta.description || "공모아 자유게시판",
    alternates: { canonical },
    openGraph: {
      type: "article",
      url: canonical,
      title: meta.title,
      description: meta.description || "공모아 자유게시판",
    },
  };
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

export default async function BoardPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getBoardViewer();
  const post = await fetchBoardPost(id, viewer);
  if (!post) notFound();

  const [, comments, liked] = await Promise.all([
    countBoardView(post.id, viewer, post.authorId),
    fetchBoardComments(post.id, viewer),
    hasLikedBoardPost(post.id, viewer.userId),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      {/* 알림에서 온 링크(#comment-…)가 해당 댓글로 정확히 내려가게 한다. */}
      <ScrollToHash />

      <Link
        href="/board"
        className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
      >
        ← 자유게시판
      </Link>

      {/* 차단한 사용자의 글(설계서 §12-2 #16): 본문·댓글 대신 안내 블록 — 앱 [id]/index.tsx 의 두
          문장 그대로. 차단 직후 이 화면이 이렇게 바뀌는 것이 "차단했어요"의 확인 문구다. */}
      {post.blocked ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-zinc-200 px-4 py-10 dark:border-zinc-700">
          <p className="text-center text-sm font-medium text-pretty text-zinc-600 dark:text-zinc-400">
            차단한 사용자의 글이에요.
          </p>
          <p className="text-center text-xs text-pretty text-zinc-400 dark:text-zinc-500">
            차단한 사용자의 글과 댓글은 보이지 않아요. 내 정보 수정에서 해제할 수 있어요.
          </p>
        </div>
      ) : (
        <>
          <article className="flex flex-col gap-5">
            <header className="flex flex-col gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                {post.isPinned ? (
                  <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                    <Pin size={11} />
                    공지
                  </span>
                ) : (
                  <Link
                    href={`/board?category=${post.category}`}
                    className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                  >
                    {boardCategoryLabel(post.category)}
                  </Link>
                )}
              </div>

              <h1 className="text-xl font-bold break-words sm:text-2xl">{post.title}</h1>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Avatar nickname={post.nickname} avatarUrl={post.avatarUrl} size="lg" />
                  <div>
                    <p className="text-sm font-semibold">{post.nickname}</p>
                    <p className="flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                      <span>{formatDateTime(post.createdAt)}</span>
                      {post.updatedAt && <span>(수정됨)</span>}
                      <span className="flex items-center gap-0.5">
                        <Eye size={11} />
                        {post.viewCount}
                      </span>
                      <span className="flex items-center gap-0.5">
                        <MessageSquare size={11} />
                        {post.commentCount}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <BoardShareButton />
                  {/* 더보기(신고·차단)는 남의 글에만. 탈퇴한 회원의 글(authorId null)은 차단할 대상이
                      없어 그리지 않는다. */}
                  {post.authorId !== null && post.authorId !== viewer.userId && (
                    <BoardMoreMenu postId={post.id} authorId={post.authorId} loggedIn={viewer.loggedIn} />
                  )}
                  {post.canEdit && (
                    <Link
                      href={`/board/${post.id}/edit`}
                      className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:text-blue-400"
                    >
                      수정
                    </Link>
                  )}
                  {post.canDelete && <BoardDeleteButton postId={post.id} />}
                </div>
              </div>
            </header>

            {/* 본문. 여기 들어오는 HTML 은 서버가 저장 전에 새니타이즈한 값이다
                (app/board/actions.ts · components/rich-text-content.tsx 주석 참고). */}
            <RichTextContent html={post.contentHtml} className="min-h-32" />

            <div className="flex justify-center py-2">
              <BoardLikeButton
                postId={post.id}
                initialLiked={liked}
                initialCount={post.likeCount}
                loggedIn={viewer.loggedIn}
              />
            </div>
          </article>

          <div className="border-t border-zinc-200 pt-6 dark:border-zinc-700">
            <BoardComments
              postId={post.id}
              comments={comments}
              commentCount={post.commentCount}
              loggedIn={viewer.loggedIn}
            />
          </div>
        </>
      )}
    </div>
  );
}
