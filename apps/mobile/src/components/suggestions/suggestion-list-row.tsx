import { router, type Href } from "expo-router";
import { Lock, Pin } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { formatSuggestionListDate } from "./suggestion-format";
import { AppText } from "../app-text";
import type { SuggestionListItem } from "../../queries/suggestions";
import { themedIcon } from "../../theme/icons";

// 목록 한 줄(웹 suggestions/page.tsx SuggestionRow 의 모바일 폭 = `sm` 미만). 웹은 sm 이상에서만 번호 칸·
// 표 머리를 그리고 폰 폭에서는 제목 줄 + (작성자·날짜·조회) 줄 두 단이다 — 그래서 번호는 받지 않는다.
// 고정 글은 제목 앞 핀 아이콘(`sm:hidden` 쪽)과 연한 호박색 배경, 비밀글은 자물쇠(내가 볼 수 있으면 파랑,
// 못 보면 회색 — readable) 로 구별한다. 볼 수 없는 비밀글의 제목은 서버가 이미 "비밀글입니다." 로 바꿔 보냈다
// (core suggestionListTitle — 화면은 그 값을 그대로 그린다).
const PinIcon = themedIcon(Pin);
const LockIcon = themedIcon(Lock);

export function SuggestionListRow({
  item,
  divider,
}: {
  item: SuggestionListItem;
  // 웹 divide-y — Uniwind 는 자식 선택자를 버리므로 두 번째 줄부터 border-t 로 그린다.
  divider: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push(`/suggestions/${item.id}` as Href)}
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
          <View accessibilityLabel="공지" className="shrink-0">
            <PinIcon size={13} colorClassName="text-amber-600 dark:text-amber-400" />
          </View>
        )}
        {item.isSecret && (
          <View accessibilityLabel="비밀글" className="shrink-0">
            <LockIcon
              size={13}
              colorClassName={item.readable ? "text-blue-600 dark:text-blue-400" : "text-zinc-400 dark:text-zinc-500"}
            />
          </View>
        )}
        <AppText
          variant="sm"
          weight={item.isPinned ? "semibold" : item.readable ? "medium" : "normal"}
          numberOfLines={1}
          className={["min-w-0 flex-1", item.readable ? "" : "italic text-zinc-400 dark:text-zinc-500"].join(" ")}
        >
          {item.title}
        </AppText>
        {item.isAnswered && (
          <View className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 dark:bg-blue-950/40">
            <AppText variant="11" weight="medium" allowFontScaling={false} className="text-blue-600 dark:text-blue-400">
              답변완료
            </AppText>
          </View>
        )}
      </View>

      <View className="flex-row items-center gap-2">
        <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
          {item.nickname}
        </AppText>
        <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
          {formatSuggestionListDate(item.createdAt)}
        </AppText>
        <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
          조회 {String(item.viewCount)}
        </AppText>
      </View>
    </Pressable>
  );
}
