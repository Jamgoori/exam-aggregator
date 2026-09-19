import { router, type Href } from "expo-router";
import { Pin } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { formatNoticeListDate } from "./notice-format";
import { AppText } from "../app-text";
import type { NoticeListItem } from "../../queries/notices";
import { themedIcon } from "../../theme/icons";

// 목록 한 줄(웹 notices/page.tsx NoticeRow 의 모바일 폭 = `sm` 미만). 웹은 sm 이상에서만 번호 칸·
// 표 머리를 그리고 폰 폭에서는 제목 줄 + (날짜·조회) 줄 두 단이다 — 그래서 번호는 받지 않는다.
// 고정 공지는 제목 앞 핀 아이콘(`sm:hidden` 쪽)과 연한 호박색 배경으로 구별한다.
const PinIcon = themedIcon(Pin);

export function NoticeListRow({
  item,
  divider,
}: {
  item: NoticeListItem;
  // 웹 divide-y — Uniwind 는 자식 선택자를 버리므로 두 번째 줄부터 border-t 로 그린다.
  divider: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(`/notices/${item.id}` as Href)}
      className={[
        "gap-1 px-4 py-3",
        item.isPinned
          ? "bg-amber-50/50 active:bg-amber-50 dark:bg-amber-950/10 dark:active:bg-amber-950/20"
          : "active:bg-zinc-50 dark:active:bg-zinc-800/40",
        divider ? "border-t border-zinc-100 dark:border-zinc-800" : "",
      ].join(" ")}
    >
      <View className="min-w-0 flex-row items-center gap-1.5">
        {item.isPinned && (
          <View accessibilityLabel="고정" className="shrink-0">
            <PinIcon size={13} colorClassName="text-amber-600 dark:text-amber-400" />
          </View>
        )}
        <AppText variant="sm" weight={item.isPinned ? "semibold" : "medium"} numberOfLines={1} className="min-w-0 flex-1">
          {item.title}
        </AppText>
      </View>

      <View className="flex-row items-center gap-2">
        <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
          {formatNoticeListDate(item.createdAt)}
        </AppText>
        <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
          조회 {String(item.viewCount)}
        </AppText>
      </View>
    </Pressable>
  );
}
