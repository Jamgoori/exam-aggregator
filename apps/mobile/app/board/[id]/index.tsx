import { canDeleteBoardPost, canEditBoardPost, type BoardViewer } from "@gongmoa/core";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View, type ScrollView } from "react-native";
import NotFoundScreen from "../../+not-found";
import { AppText } from "../../../src/components/app-text";
import { BoardComments } from "../../../src/components/board/board-comments";
import { BoardLikeButton } from "../../../src/components/board/board-post-actions";
import { BoardPostHeader } from "../../../src/components/board/board-post-header";
import { InlineAlert } from "../../../src/components/feedback";
import { RichTextContent } from "../../../src/components/rich-text-content";
import { Screen } from "../../../src/components/screen";
import { Skeleton } from "../../../src/components/skeleton";
import { useAvatarUrls } from "../../../src/queries/avatars";
import {
  buildBoardCommentTree,
  countBoardView,
  useBlockedIds,
  useBoardComments,
  useBoardPost,
  type BoardPostDetail,
} from "../../../src/queries/board";
import { useAuth } from "../../../src/providers/auth-provider";
import { useIsDark } from "../../../src/theme";

// `/board/[id]`(설계서 §5 행, O — 좋아요·댓글은 L) — 웹 app/board/[id]/page.tsx + board-post-actions.tsx +
// board-comments.tsx 이식. 블록 순서도 웹과 같다: "← 자유게시판" → 머리 → 본문(RichTextContent) →
// 좋아요 → 댓글.
//
// 알림 링크 `/board/{id}#comment-{commentId}`: expo-router 는 해시를 params["#"] 로 준다(getStateFromPath
// parseQueryParams — 값은 `#` 뗀 문자열). 그 댓글의 레이아웃이 잡히면 ScrollView 를 그 자리로 내리고
// (웹 ScrollToHash) 잠깐 배경을 칠한다. 스크롤은 마운트 직후(오프셋 0)에만 하므로 measureLayout 이
// 돌려주는 y 가 곧 콘텐츠 좌표다.
//
// 차단(앱 전용, §6.7 #18): 글쓴이를 차단했으면 본문 대신 안내 한 줄을 그린다 — 차단 직후 이 화면이 그렇게
// 바뀌는 것이 "차단했어요"의 확인 문구다. 댓글은 buildBoardCommentTree 가 차단 사용자를 뺀다.
type Params = { id: string; "#"?: string };

const COMMENT_HASH_PREFIX = "comment-";
// 웹 `scroll-mt-24`(96px)는 고정 헤더 아래로 들어가지 않으려는 여백인데, 앱 헤더는 스크롤 밖에 있어 그만큼
// 필요 없다 — 댓글 위에 숨 쉴 틈만 둔다.
const SCROLL_TOP_MARGIN = 16;
const HIGHLIGHT_MS = 2_000;

export default function BoardPostRoute() {
  const params = useLocalSearchParams<Params>();
  const id = typeof params.id === "string" ? params.id : undefined;
  const hash = typeof params["#"] === "string" ? params["#"] : "";
  const targetCommentId = hash.startsWith(COMMENT_HASH_PREFIX) ? hash.slice(COMMENT_HASH_PREFIX.length) : null;

  const post = useBoardPost(id);

  // 순서(§6.9): 스켈레톤 → InlineAlert+재시도 → 없으면 404(웹 notFound) → 본문.
  if (post.isPending) {
    return (
      <Screen contentClassName="gap-6">
        <BoardPostSkeleton />
      </Screen>
    );
  }
  if (post.isError) {
    return (
      <Screen contentClassName="gap-6">
        <InlineAlert
          message={post.error instanceof Error ? post.error.message : "글을 불러오지 못했어요."}
          onRetry={() => void post.refetch()}
        />
      </Screen>
    );
  }
  if (!post.data) return <NotFoundScreen />;
  return <BoardPostScreen post={post.data} isRefetching={post.isRefetching} refetch={() => void post.refetch()} targetCommentId={targetCommentId} />;
}

function BoardPostScreen({
  post,
  isRefetching,
  refetch,
  targetCommentId,
}: {
  post: BoardPostDetail;
  isRefetching: boolean;
  refetch: () => void;
  targetCommentId: string | null;
}) {
  const { userId, isAdmin, loading } = useAuth();
  const dark = useIsDark();
  const viewer: BoardViewer = useMemo(() => ({ userId, isAdmin }), [userId, isAdmin]);
  const comments = useBoardComments(post.id);
  const { ids: blockedIds } = useBlockedIds();
  const scrollRef = useRef<ScrollView>(null);

  // 조회수(웹 countBoardView — Promise.all 안에서 본문과 함께, 본인 글은 안 센다). 세션 판정이 끝난 뒤 글마다
  // 한 번. 웹은 화면에 **증가 전** 값을 보여주므로(같은 렌더에서 읽은 값) 여기서도 캐시를 올리지 않는다.
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (loading || counted.current === post.id) return;
    counted.current = post.id;
    void countBoardView(post.id, userId, post.authorId);
  }, [loading, userId, post.id, post.authorId]);

  // 아바타: 글쓴이 + 댓글 작성자 전부를 **한 번에**(N+1 금지).
  const authorIds = useMemo(
    () => [post.authorId, ...(comments.data ?? []).map((c) => c.authorId)],
    [post.authorId, comments.data],
  );
  const avatars = useAvatarUrls(authorIds).data ?? {};

  const nodes = useMemo(() => buildBoardCommentTree(comments.data ?? [], blockedIds), [comments.data, blockedIds]);

  // 해시 대상 댓글: 한 번만 스크롤하고, 그 뒤 HIGHLIGHT_MS 동안 강조.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (!highlightedId) return;
    const t = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [highlightedId]);

  function onTargetLayout(view: View) {
    if (scrolled.current) return;
    const scroll = scrollRef.current;
    const host = scroll?.getNativeScrollRef();
    if (!scroll || !host) return;
    scrolled.current = true;
    view.measureLayout(
      host,
      (_x, y) => {
        scroll.scrollTo({ y: Math.max(0, y - SCROLL_TOP_MARGIN), animated: true });
        setHighlightedId(targetCommentId);
      },
      () => {
        // 측정 실패(언마운트 경합) — 강조만 해 둔다. 스크롤은 사용자가 내리면 된다.
        setHighlightedId(targetCommentId);
      },
    );
  }

  const ownership = { user_id: post.authorId };
  const isOwn = userId !== null && userId === post.authorId;
  // 탈퇴한 회원의 글(authorId null)은 차단 대상이 없다 — 그대로 보여준다.
  const blocked = post.authorId !== null && blockedIds.has(post.authorId);

  return (
    <Screen
      scrollRef={scrollRef}
      contentClassName="gap-6"
      refreshing={isRefetching}
      onRefresh={() => {
        refetch();
        void comments.refetch();
      }}
    >
      <Pressable accessibilityRole="link" onPress={() => router.navigate("/board")} hitSlop={6} className="self-start">
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
          ← 자유게시판
        </AppText>
      </Pressable>

      {blocked ? (
        <View className="gap-2 rounded-2xl border border-dashed border-zinc-200 px-4 py-10 dark:border-zinc-700">
          <AppText variant="sm" weight="medium" className="text-center text-zinc-600 dark:text-zinc-400" pretty>
            차단한 사용자의 글이에요.
          </AppText>
          <AppText variant="xs" className="text-center text-zinc-400 dark:text-zinc-500" pretty>
            차단한 사용자의 글과 댓글은 보이지 않아요. 내 정보 수정에서 해제할 수 있어요.
          </AppText>
        </View>
      ) : (
        <>
          <View className="gap-5">
            <BoardPostHeader
              post={post}
              avatarUrl={(post.authorId !== null && avatars[post.authorId]) || null}
              canEdit={canEditBoardPost(ownership, viewer)}
              canDelete={canDeleteBoardPost(ownership, viewer)}
              isOwn={isOwn}
              loggedIn={userId !== null}
            />

            {/* 본문. 여기 들어오는 HTML 은 서버가 저장 전에 새니타이즈한 값이다(EF board-write ·
                components/rich-text-content.tsx 머리말). */}
            <RichTextContent html={post.contentHtml} className="min-h-32" />

            <View className="items-center py-2">
              <BoardLikeButton postId={post.id} likeCount={post.likeCount} loggedIn={userId !== null} dark={dark} />
            </View>
          </View>

          <View className="border-t border-zinc-200 pt-6 dark:border-zinc-700">
            {comments.isPending ? (
              <View className="gap-3">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-24 rounded-xl" delay={80} />
                <Skeleton className="h-16 rounded-xl" delay={160} />
              </View>
            ) : comments.isError ? (
              <InlineAlert
                message={comments.error instanceof Error ? comments.error.message : "댓글을 불러오지 못했어요."}
                onRetry={() => void comments.refetch()}
              />
            ) : (
              <BoardComments
                postId={post.id}
                nodes={nodes}
                commentCount={post.commentCount}
                viewer={viewer}
                avatars={avatars}
                targetCommentId={targetCommentId}
                highlightedCommentId={highlightedId}
                onTargetLayout={onTargetLayout}
              />
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

// 머리(배지·제목·작성자 줄) + 본문 자리. 웹에는 상세 loading.tsx 가 없어 목록 스켈레톤 구도를 따랐다.
function BoardPostSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-20" />
      <View className="gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-700">
        <Skeleton className="h-5 w-12 rounded-full" delay={50} />
        <Skeleton className="h-7 w-full" delay={100} />
        <View className="flex-row items-center gap-2">
          <Skeleton className="h-9 w-9 rounded-full" delay={150} />
          <View className="gap-1">
            <Skeleton className="h-4 w-20" delay={150} />
            <Skeleton className="h-3 w-40" delay={150} />
          </View>
        </View>
      </View>
      <Skeleton className="h-32 w-full rounded-xl" delay={200} />
    </>
  );
}
