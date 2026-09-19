import { boardCategoryLabel } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Eye, MessageSquare } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { formatBoardPostDateTime } from "./board-format";
import { PinnedBadge } from "./board-list-row";
import { BoardDeleteButton, BoardMoreMenu, BoardShareButton, HEADER_BUTTON_CLASS, HEADER_BUTTON_TEXT } from "./board-post-actions";
import { AppText } from "../app-text";
import { Avatar } from "../avatar";
import type { BoardPostDetail } from "../../queries/board";
import { themedIcon } from "../../theme/icons";

// 글 머리(웹 board/[id]/page.tsx <header>): 말머리(또는 공지) → 제목 → 아바타·닉네임·날짜·(수정됨)·조회수·
// 댓글 수 / 공유·수정·삭제. 그 옆 더보기(⋯ 신고·차단)는 웹에 없는 것으로, 본인 글에는 그리지 않는다.
const EyeIcon = themedIcon(Eye);
const MessageIcon = themedIcon(MessageSquare);

export function BoardPostHeader({
  post,
  avatarUrl,
  canEdit,
  canDelete,
  isOwn,
  loggedIn,
}: {
  post: BoardPostDetail;
  avatarUrl: string | null;
  canEdit: boolean;
  canDelete: boolean;
  isOwn: boolean;
  loggedIn: boolean;
}) {
  return (
    <View className="gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-700">
      <View className="flex-row items-center gap-2">
        {post.isPinned ? (
          <PinnedBadge iconSize={11} />
        ) : (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push(`/board?category=${post.category}` as Href)}
            className="rounded-full bg-zinc-100 px-2 py-0.5 active:bg-zinc-200 dark:bg-zinc-800 dark:active:bg-zinc-700"
          >
            <AppText variant="11" weight="medium" allowFontScaling={false} className="text-zinc-600 dark:text-zinc-300">
              {boardCategoryLabel(post.category)}
            </AppText>
          </Pressable>
        )}
      </View>

      {/* 웹 `text-xl font-bold break-words sm:text-2xl` — 폰 폭이라 xl. */}
      <AppText variant="xl" weight="bold" accessibilityRole="header" pretty>
        {post.title}
      </AppText>

      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <Avatar nickname={post.nickname} avatarUrl={avatarUrl} size="lg" />
          <View>
            <AppText variant="sm" weight="semibold">
              {post.nickname}
            </AppText>
            <View className="flex-row items-center gap-2">
              <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
                {formatBoardPostDateTime(post.createdAt)}
              </AppText>
              {post.updatedAt && (
                <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
                  (수정됨)
                </AppText>
              )}
              <View className="flex-row items-center gap-0.5">
                <EyeIcon size={11} colorClassName="text-zinc-400 dark:text-zinc-500" />
                <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
                  {String(post.viewCount)}
                </AppText>
              </View>
              <View className="flex-row items-center gap-0.5">
                <MessageIcon size={11} colorClassName="text-zinc-400 dark:text-zinc-500" />
                <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
                  {String(post.commentCount)}
                </AppText>
              </View>
            </View>
          </View>
        </View>

        <View className="flex-row flex-wrap items-center gap-2">
          <BoardShareButton postId={post.id} />
          {canEdit && (
            // `/board/[id]/edit` 화면은 B2(app/board/[id]/edit.tsx).
            <Pressable
              accessibilityRole="link"
              onPress={() => router.push(`/board/${post.id}/edit` as Href)}
              className={[HEADER_BUTTON_CLASS, "active:border-blue-300 dark:active:border-blue-800"].join(" ")}
            >
              <AppText variant="xs" weight="medium" className={HEADER_BUTTON_TEXT}>
                수정
              </AppText>
            </Pressable>
          )}
          {canDelete && <BoardDeleteButton postId={post.id} />}
          {!isOwn && <BoardMoreMenu postId={post.id} authorId={post.authorId} loggedIn={loggedIn} />}
        </View>
      </View>
    </View>
  );
}
