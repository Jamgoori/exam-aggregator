import { notificationMessage, relativeTimeLabel, type NotificationItem } from "@gongmoa/core";
import { X } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 알림 한 줄. 종(Sheet)과 목록 화면이 같은 줄을 쓴다 — 웹도 notification-bell.tsx 와
// notification-list.tsx 가 같은 구성(닉네임 + 문구 / 미리보기 / 글 제목 · 상대시각)을 쓰고,
// 목록 쪽만 안 읽음 점과 삭제 버튼이 더 붙는다(종에는 그 자리가 없다).
//
// 안 읽은 줄의 파란 배경(bg-blue-50/50)도 웹과 같다 — 배지 숫자와 목록이 같은 것을 가리켜야
// "몇 개가 새 알림인지"를 두 번 세지 않는다.
const CloseIcon = themedIcon(X);

export function NotificationRow({
  item,
  onPress,
  onDelete,
  // 종(Sheet)은 좁아서 웹 드롭다운처럼 글자를 한 단계 줄이고 미리보기를 한 줄로 자른다.
  compact = false,
  // 줄 사이 구분선(웹 divide-y). 마지막 줄에는 긋지 않는다 — 목록을 감싼 테두리·시트 바닥
  // 구분선과 겹쳐 두 줄로 보인다.
  divider = true,
}: {
  item: NotificationItem;
  onPress: () => void;
  onDelete?: () => void;
  compact?: boolean;
  divider?: boolean;
}) {
  return (
    <View className={["relative", divider ? "border-b border-zinc-100 dark:border-zinc-800" : ""].join(" ")}>
      <Pressable
        accessibilityRole="link"
        onPress={onPress}
        className={[
          "flex-col gap-0.5",
          compact ? "px-4 py-3" : "px-4 py-3.5 pr-12",
          item.isRead
            ? "active:bg-zinc-50 dark:active:bg-zinc-800/50"
            : "bg-blue-50/50 active:bg-blue-50 dark:bg-blue-950/20 dark:active:bg-blue-950/30",
        ].join(" ")}
      >
        <View className="flex-row items-center gap-1.5">
          {/* 목록에서만: 안 읽음 점(웹 notification-list.tsx). 종은 배경색으로만 구분한다. */}
          {!compact && !item.isRead && (
            <View
              accessibilityLabel="안 읽음"
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
            />
          )}
          <AppText
            variant={compact ? "13" : "sm"}
            className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300"
            numberOfLines={2}
          >
            <AppText variant={compact ? "13" : "sm"} weight="semibold">
              {item.actorNickname}
            </AppText>
            {notificationMessage(item.type)}
          </AppText>
        </View>

        {!!item.preview && (
          <AppText
            variant="xs"
            className="text-zinc-500 dark:text-zinc-400"
            numberOfLines={compact ? 1 : 2}
          >
            {item.preview}
          </AppText>
        )}

        <View className="flex-row items-center gap-1.5">
          <AppText
            variant="11"
            numberOfLines={1}
            className={[
              "shrink text-zinc-400 dark:text-zinc-500",
              compact ? "max-w-[10rem]" : "max-w-[14rem]",
            ].join(" ")}
          >
            {item.title}
          </AppText>
          <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
            ·
          </AppText>
          <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
            {relativeTimeLabel(item.createdAt)}
          </AppText>
        </View>
      </Pressable>

      {onDelete && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="알림 삭제"
          onPress={onDelete}
          hitSlop={6}
          className="absolute top-3 right-3 h-7 w-7 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
        >
          <CloseIcon size={14} colorClassName="text-zinc-300 dark:text-zinc-600" />
        </Pressable>
      )}
    </View>
  );
}
