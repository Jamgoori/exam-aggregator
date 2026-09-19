import { boardCategoryLabel } from "@gongmoa/core";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { Eye, Heart, MessageSquare, Pin } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { formatBoardListDate } from "./board-format";
import { AppText } from "../app-text";
import { Avatar } from "../avatar";
import type { BoardListItem } from "../../queries/board";
import { themedIcon } from "../../theme/icons";

// 목록 한 줄(웹 board/page.tsx PostRow 1:1). 표가 아니라 카드로 그리는 이유(웹 주석): 본문 미리보기와
// 썸네일이 있어야 "들어가 볼 만한 글인지"가 제목 한 줄보다 훨씬 빨리 판단된다.
//
// 아바타는 줄이 직접 조회하지 않는다 — 화면이 useAvatarUrls 로 **목록 전체를 한 번에** 받아 URL 을
// 내려준다(N+1 금지). 비로그인은 그 훅이 돌지 않아 첫 글자 아바타가 그려진다(queries/avatars.ts).
const EyeIcon = themedIcon(Eye);
const HeartIcon = themedIcon(Heart);
const MessageIcon = themedIcon(MessageSquare);
const PinIcon = themedIcon(Pin);

// 말머리 배지 색(웹 CATEGORY_STYLE 과 같은 문자열). View 와 Text 에 같은 클래스를 주면 각자 bg-*/text-*
// 만 읽는다(components/badge.tsx 와 같은 방식).
export const CATEGORY_STYLE: Record<string, string> = {
  free: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  question: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
  review: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
};

// 고정 글(공지) 배지 — 목록·글 머리가 같은 모양을 쓴다(웹 두 곳의 span 이 같은 클래스).
export function PinnedBadge({ iconSize = 10 }: { iconSize?: number }) {
  return (
    <View className="shrink-0 flex-row items-center gap-0.5 rounded-full bg-amber-100 px-2 py-0.5 dark:bg-amber-950/40">
      <PinIcon size={iconSize} colorClassName="text-amber-700 dark:text-amber-400" />
      <AppText variant="11" weight="bold" allowFontScaling={false} className="text-amber-700 dark:text-amber-400">
        공지
      </AppText>
    </View>
  );
}

export function BoardListRow({
  item,
  avatarUrl,
  divider,
}: {
  item: BoardListItem;
  avatarUrl: string | null;
  // 웹 divide-y — Uniwind 는 자식 선택자를 버리므로 두 번째 줄부터 border-t 로 그린다.
  divider: boolean;
}) {
  const categoryStyle = CATEGORY_STYLE[item.category] ?? CATEGORY_STYLE.free;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(`/board/${item.id}` as Href)}
      className={[
        "flex-row gap-3 px-4 py-4",
        item.isPinned
          ? "bg-amber-50/40 active:bg-amber-50/70 dark:bg-amber-950/10 dark:active:bg-amber-950/20"
          : "active:bg-zinc-50 dark:active:bg-zinc-800/40",
        divider ? "border-t border-zinc-100 dark:border-zinc-800" : "",
      ].join(" ")}
    >
      <View className="min-w-0 flex-1 gap-1.5">
        <View className="flex-row items-center gap-1.5">
          {item.isPinned ? (
            <PinnedBadge />
          ) : (
            <View className={["shrink-0 rounded-full px-2 py-0.5", categoryStyle].join(" ")}>
              <AppText variant="11" weight="medium" allowFontScaling={false} className={categoryStyle}>
                {boardCategoryLabel(item.category)}
              </AppText>
            </View>
          )}
          <AppText variant="15" weight="semibold" numberOfLines={1} className="min-w-0 flex-1">
            {item.title}
          </AppText>
        </View>

        {item.preview ? (
          <AppText variant="13" numberOfLines={2} className="text-zinc-500 dark:text-zinc-400">
            {item.preview}
          </AppText>
        ) : null}

        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <View className="flex-row items-center gap-1.5">
            <Avatar nickname={item.nickname} avatarUrl={avatarUrl} size="sm" />
            <AppText variant="11" weight="medium" className="text-zinc-500 dark:text-zinc-400">
              {item.nickname}
            </AppText>
          </View>
          <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
            {formatBoardListDate(item.createdAt)}
          </AppText>
          <View className="flex-row items-center gap-0.5">
            <EyeIcon size={12} colorClassName="text-zinc-400 dark:text-zinc-500" />
            <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
              {String(item.viewCount)}
            </AppText>
          </View>
          {item.commentCount > 0 && (
            <View className="flex-row items-center gap-0.5">
              <MessageIcon size={12} colorClassName="text-blue-600 dark:text-blue-400" />
              <AppText variant="11" weight="medium" className="text-blue-600 dark:text-blue-400">
                {String(item.commentCount)}
              </AppText>
            </View>
          )}
          {item.likeCount > 0 && (
            <View className="flex-row items-center gap-0.5">
              <HeartIcon size={12} colorClassName="text-rose-500" />
              <AppText variant="11" className="text-rose-500">
                {String(item.likeCount)}
              </AppText>
            </View>
          )}
        </View>
      </View>

      {item.thumbnailUrl && (
        // 웹 `h-16 w-16 rounded-xl bg-zinc-100 object-cover`(sm 이상 h-20 은 폰 폭이라 안 쓴다). expo-image 는
        // className 이 버려지므로 배경은 바깥 View 에, 크기는 style 로(components/avatar.tsx 와 같은 사정).
        <View className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800">
          <Image
            source={{ uri: item.thumbnailUrl }}
            cachePolicy="memory-disk"
            contentFit="cover"
            accessible={false}
            style={{ width: 64, height: 64 }}
          />
        </View>
      )}
    </Pressable>
  );
}
