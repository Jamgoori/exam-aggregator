import { NOTIFICATIONS_PAGE_SIZE } from "@gongmoa/core";
import { router, useLocalSearchParams } from "expo-router";
import { Bell, Check } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { EmptyState } from "../../src/components/feedback";
import { LoginRequiredScreen, useRequireLogin } from "../../src/components/mypage/require-login";
import { NotificationRow } from "../../src/components/notifications/notification-row";
import { useOpenNotification } from "../../src/components/notifications/open-notification";
import { Pagination } from "../../src/components/pagination";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { useSetScreenParams } from "../../src/lib/screen-params";
import {
  notificationActionError,
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useNotificationPage,
  useUnreadNotificationCount,
} from "../../src/queries/notifications";
import { themedIcon } from "../../src/theme/icons";

// `/notifications?page`(설계서 §5 행, L) — 웹 app/notifications/page.tsx + notification-list.tsx 이식.
//
// 헤더의 종은 최근 8건만 보여주므로, 그보다 예전 것을 찾거나 한꺼번에 정리하려는 사람이 오는
// 자리다(웹 머리말). 종과 다른 점도 웹과 같다: 안 읽음 점과 줄마다 삭제 버튼이 있다.
const BellIcon = themedIcon(Bell);
const CheckIcon = themedIcon(Check);

export default function NotificationsScreen() {
  const { userId, loading } = useRequireLogin("/notifications");
  const params = useLocalSearchParams<{ page?: string }>();
  const setScreenParams = useSetScreenParams();
  const page = Math.max(1, Number(params.page) || 1);

  const query = useNotificationPage(page);
  const unread = useUnreadNotificationCount();
  const markAll = useMarkAllNotificationsRead();
  const remove = useDeleteNotification();
  const openItem = useOpenNotification();

  if (loading) return <Screen contentClassName="gap-6" />;
  if (!userId) return <LoginRequiredScreen />;

  const count = unread.data ?? 0;
  const total = query.data?.total ?? 0;
  // 삭제·모두 읽음은 낙관적으로 먼저 반영하고 실패하면 되돌린다 — 왜 되돌아왔는지 한 줄은
  // 남겨야 한다(§6.9 2). 문구는 서버(RPC)가 준 문장 그대로다.
  const actionError = notificationActionError(markAll.error, remove.error);
  const totalPages = Math.max(1, Math.ceil(total / NOTIFICATIONS_PAGE_SIZE));

  return (
    <Screen
      contentClassName="gap-6"
      refreshing={query.isRefetching}
      // 머리말의 "안 읽은 알림 N개"는 목록이 아니라 개수 쿼리에서 온다 — 같이 새로 읽지
      // 않으면 당겨서 새로고침한 화면에서 목록만 최신이 되고 숫자는 최대 1분 뒤처진다.
      onRefresh={() => {
        void query.refetch();
        void unread.refetch();
      }}
    >
      <View className="gap-1">
        <Pressable
          accessibilityRole="link"
          onPress={() => router.navigate("/mypage")}
          hitSlop={6}
          className="self-start"
        >
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 마이페이지
          </AppText>
        </Pressable>
        <View className="mt-1 flex-row items-center gap-2">
          <View className="h-9 w-9 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-950/40">
            <BellIcon size={18} colorClassName="text-blue-600 dark:text-blue-400" />
          </View>
          <View>
            <AppText variant="2xl" weight="bold" accessibilityRole="header">
              알림
            </AppText>
            <AppText variant="xs" className="text-zinc-500 dark:text-zinc-400">
              {count > 0 ? `안 읽은 알림 ${count}개` : "모두 읽었어요"}
            </AppText>
          </View>
        </View>
      </View>

      <View className="gap-3">
        {count > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => markAll.mutate()}
            disabled={markAll.isPending}
            className={[
              "flex-row items-center gap-1 self-end rounded-lg border border-zinc-200 px-3 py-1.5 active:border-blue-300 dark:border-zinc-700",
              markAll.isPending ? "opacity-50" : "",
            ].join(" ")}
          >
            <CheckIcon size={13} colorClassName="text-zinc-600 dark:text-zinc-300" />
            <AppText variant="xs" weight="medium" className="text-zinc-600 dark:text-zinc-300">
              모두 읽음으로 표시
            </AppText>
          </Pressable>
        )}

        {actionError && (
          <AppText
            variant="xs"
            accessibilityRole="alert"
            className="text-red-600 dark:text-red-400"
          >
            {actionError}
          </AppText>
        )}

        <QueryState
          query={query}
          isEmpty={(data) => data.items.length === 0}
          skeleton={<NotificationsSkeleton />}
          empty={
            // 문구는 웹 notification-list.tsx 의 빈 상태 그대로. 다만 그 아래 "자유게시판
            // 둘러보기" 버튼은 그리지 않는다 — 게시판 화면은 Phase 5 라 지금 누르면
            // +not-found 로 떨어진다(다른 문구로 바꿔 적지도 않는다; 화면이 생기면 붙인다).
            <EmptyState
              icon={<BellIcon size={26} colorClassName="text-zinc-300 dark:text-zinc-600" />}
              title="아직 받은 알림이 없어요."
              description="내 글에 댓글이 달리거나 내 댓글에 답글이 달리면 여기로 알려드려요."
              className="py-16"
            />
          }
        >
          {(data) => (
            <View className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
              {data.items.map((item, i) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  divider={i < data.items.length - 1}
                  onPress={() => openItem(item)}
                  onDelete={() => remove.mutate(item.id)}
                />
              ))}
            </View>
          )}
        </QueryState>
      </View>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        onChange={(next) => setScreenParams({ page: next > 1 ? String(next) : undefined })}
      />
    </Screen>
  );
}

function NotificationsSkeleton() {
  return (
    <View className="gap-2 overflow-hidden rounded-2xl border border-zinc-200 p-3 dark:border-zinc-700">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-14 rounded-xl" delay={i * 80} />
      ))}
    </View>
  );
}
