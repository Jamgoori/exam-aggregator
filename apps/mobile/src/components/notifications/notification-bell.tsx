import { unreadBadgeLabel } from "@gongmoa/core";
import { router } from "expo-router";
import { Bell, Check } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { NotificationRow } from "./notification-row";
import { useOpenNotification } from "./open-notification";
import { AppText } from "../app-text";
import { EmptyState } from "../feedback";
import { QueryState } from "../query-state";
import { Sheet } from "../sheet";
import { Skeleton } from "../skeleton";
import { useAuth } from "../../providers/auth-provider";
import {
  notificationActionError,
  useMarkAllNotificationsRead,
  useNotificationBellFeed,
  useUnreadNotificationBadge,
} from "../../queries/notifications";
import { themedIcon } from "../../theme/icons";

// 헤더의 알림 종(웹 notification-bell.tsx, 설계서 §4.5 #15). 웹은 드롭다운이지만 앱은 **Sheet** —
// 폰 폭에서 헤더 오른쪽에 매달린 패널은 손가락에 가려지고, 목록을 스크롤하면 뒤 화면이 같이
// 움직인다. 담는 것은 웹과 같다: 최근 8건 + "모두 읽음" + "알림 전체보기".
//
// 배지 숫자는 core unreadBadgeLabel(99 초과는 "99+")이고, 개수는 60초 폴링 + 포그라운드 재조회로
// 받는다(queries/notifications.ts). **비로그인에게는 종 자체를 그리지 않는다**(웹 site-header 와
// 같다 — 게스트에게는 받을 알림이 없다). 폴링도 그래서 돌지 않는다.
const BellIcon = themedIcon(Bell);
const CheckIcon = themedIcon(Check);

export function NotificationBell() {
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  const unread = useUnreadNotificationBadge();
  // 열기 전에는 목록을 부르지 않는다. 열 때마다 새로 읽는 것도 웹과 같다(staleTime 30초를 넘겨
  // 열면 다시 받는다) — 열어둔 채 몇 분이 지난 뒤 다시 열었을 때 옛 목록이 그대로 남아 있으면
  // "알림이 안 온다"로 읽힌다.
  const feed = useNotificationBellFeed(open);
  const markAll = useMarkAllNotificationsRead();
  const openItem = useOpenNotification();

  // 훅을 먼저 다 부른 뒤 게스트를 걸러낸다(위 쿼리들은 enabled:false 라 요청이 나가지 않는다).
  if (!userId) return null;

  const count = unread.data ?? 0;
  const badge = unreadBadgeLabel(count);
  // "모두 읽음"이 실패하면 낙관적으로 지웠던 배지가 다시 나타난다 — 왜 되돌아왔는지 한 줄은
  // 남겨야 한다(§6.9 2). 웹은 이 실패를 버리지만, 앱은 되돌아온 화면 말고는 단서가 없다.
  const actionError = notificationActionError(markAll.error);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={count > 0 ? `알림 ${count}개` : "알림"}
        onPress={() => setOpen(true)}
        className="h-9 w-9 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
      >
        <BellIcon size={19} colorClassName="text-zinc-600 dark:text-zinc-300" />
        {!!badge && (
          // 웹의 ring-2 ring-white 는 RN 에 없으므로 같은 두께의 테두리로 낸다(배지가 종 위에
          // 겹칠 때 헤더 배경색으로 한 겹 떠 보이게 하는 장치라 색도 웹과 같게 맞춘다).
          <View className="absolute -top-0.5 -right-0.5 h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 dark:border-zinc-950">
            <AppText variant="10" weight="bold" tabular allowFontScaling={false} className="text-white">
              {badge}
            </AppText>
          </View>
        )}
      </Pressable>

      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        title="알림"
        icon={<BellIcon size={17} colorClassName="text-white" />}
        // 웹 드롭다운의 max-h-[70vh] 와 같은 자리 — 높이를 고정하지 않아 알림이 0~2건일 때
        // 빈 시트가 화면을 절반 덮지 않는다.
        maxHeight="70%"
      >
        {count > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="flex-row items-center gap-1 self-end px-4 py-2.5"
          >
            <CheckIcon size={12} colorClassName="text-zinc-500 dark:text-zinc-400" />
            <AppText variant="11" weight="medium" className="text-zinc-500 dark:text-zinc-400">
              모두 읽음
            </AppText>
          </Pressable>
        )}

        {actionError && (
          <AppText
            variant="xs"
            accessibilityRole="alert"
            className="px-4 pb-2 text-red-600 dark:text-red-400"
          >
            {actionError}
          </AppText>
        )}

        <ScrollView className="min-h-0 shrink" contentContainerClassName="pb-1">
          <QueryState
            query={feed}
            isEmpty={(page) => page.items.length === 0}
            skeleton={
              <View className="gap-2 p-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 rounded-xl" delay={i * 80} />
                ))}
              </View>
            }
            empty={
              // 문구는 웹 드롭다운의 빈 상태 그대로(목록 화면 쪽은 한 문장이 더 길다).
              <EmptyState
                icon={<BellIcon size={22} colorClassName="text-zinc-300 dark:text-zinc-600" />}
                title="아직 받은 알림이 없어요."
                description="내 글에 댓글이 달리면 여기로 알려드려요."
                className="m-3 py-10"
              />
            }
          >
            {(page) => (
              <View>
                {page.items.map((item, i) => (
                  <NotificationRow
                    key={item.id}
                    item={item}
                    compact
                    divider={i < page.items.length - 1}
                    onPress={() => {
                      setOpen(false);
                      openItem(item);
                    }}
                  />
                ))}
              </View>
            )}
          </QueryState>
        </ScrollView>

        <Pressable
          accessibilityRole="link"
          onPress={() => {
            setOpen(false);
            router.push("/notifications");
          }}
          className="border-t border-zinc-100 px-4 py-2.5 active:bg-blue-50/60 dark:border-zinc-800 dark:active:bg-blue-950/30"
        >
          <AppText variant="xs" weight="medium" className="text-center text-blue-600 dark:text-blue-400">
            알림 전체보기
          </AppText>
        </Pressable>
      </Sheet>
    </>
  );
}
