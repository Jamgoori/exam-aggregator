import {
  NOTIFICATION_DROPDOWN_SIZE,
  NOTIFICATIONS_PAGE_SIZE,
  safeNotificationLink,
  type NotificationItem,
  type NotificationType,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 알림함 — 조회는 `notifications` 를 RLS 로 직접(select own), 쓰기는 RPC 세 개(설계서 §6.7 #15).
//
// 이 표에는 **update·delete 정책이 일부러 없다**(schema.sql notifications 절): 읽음 처리까지
// 클라이언트에 열면 정책이 컬럼을 가리지 못해 자기 알림의 link·title 을 REST 로 아무 값으로나
// 바꿔둘 수 있다. 웹은 서버 액션(service_role)으로 쓰지만 앱에는 그 경로가 없어서,
// `mark_notification_read`·`mark_all_notifications_read`·`delete_notification`(SD RPC)만 부른다.
// 조회는 select-own 정책이 이미 있으므로 Edge Function 을 새로 만들지 않는다.
//
// **퍼시스트 O**(§6.3 "본인 RLS 데이터" 행에 알림이 명시돼 있고, §6.5 의 "절대 디스크에 남기지
// 않는 것"(정답·해설 본문·복습 세션 항목·멤버십·진단 리포트)에 하나도 해당하지 않는다). 알림은
// 이미 사용자에게 보낸 게시판 활동 요약이고, 오프라인에서 마지막 목록을 보여주는 쪽이 빈 화면
// 보다 낫다 — 그래서 meta.persist 를 끄지 않는다(기본값 유지).

// 배지 폴링 주기. 웹 notification-bell.tsx 의 POLL_INTERVAL_MS 와 같은 60초 —
// 알림이 1분 늦게 와도 아무 문제가 없는 기능이라 Realtime 연결을 상시로 잡지 않는다(§6.4).
const POLL_INTERVAL_MS = 60_000;

const COLUMNS = "id, type, actor_nickname, title, preview, link, read_at, created_at";

export type NotificationPage = {
  items: NotificationItem[];
  total: number;
};

export const notificationsKey = (userId: string) => ["me", userId, "notifications"] as const;
// 목록(종의 최근 8건·페이지)은 한 접두 아래 둔다 — 읽음·삭제가 "지금 떠 있는 모든 목록"을
// 한 번에 고쳐야 하는데, 그때 이 접두로 setQueriesData 를 건다.
const listsKey = (userId: string) => [...notificationsKey(userId), "list"] as const;
const bellKey = (userId: string) => [...listsKey(userId), "bell"] as const;
const pageKey = (userId: string, page: number) => [...listsKey(userId), page] as const;
const unreadKey = (userId: string) => [...notificationsKey(userId), "unread"] as const;

function toItem(row: Record<string, unknown>): NotificationItem {
  return {
    id: row.id as string,
    // 종류는 DB check(notifications_type_check)와 core NOTIFICATION_TYPES 가 함께 관리한다
    // (AGENTS.md "알림 종류는 두 곳 — 반드시 함께 고칠 것"). 서버가 앱보다 먼저 새 종류를
    // 내보내면 notificationMessage 의 switch 가 어느 가지에도 걸리지 않아 undefined 를
    // 돌려주고(문구 자리가 빈 줄이 된다), 그래도 그 줄을 목록에서 빼지는 않는다 — 배지
    // 숫자는 DB 가 세므로 줄만 감추면 "배지 1, 목록 0"이 된다.
    type: row.type as NotificationType,
    actorNickname: row.actor_nickname as string,
    title: row.title as string,
    preview: (row.preview as string) ?? "",
    link: safeNotificationLink(row.link),
    isRead: row.read_at !== null,
    createdAt: row.created_at as string,
  };
}

async function fetchNotifications(
  userId: string,
  { limit, offset = 0 }: { limit: number; offset?: number },
): Promise<NotificationPage> {
  const { data, count, error } = await supabase
    .from("notifications")
    .select(COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`알림 조회 실패: ${error.message}`);
  return {
    items: (data ?? []).map((row) => toItem(row as Record<string, unknown>)),
    total: count ?? 0,
  };
}

async function fetchUnreadCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw new Error(`알림 개수 조회 실패: ${error.message}`);
  return count ?? 0;
}

// 배지 숫자만 갱신하는 가벼운 조회 — 웹 loadUnreadCount 와 같은 이유로 목록을 같이 싣지
// 않는다(1분마다 알림 8건이 왕복한다). 폴링은 걸지 않는다: 알림함 화면처럼 "지금 화면에
// 숫자를 그리는" 자리가 쓴다.
export function useUnreadNotificationCount() {
  const { userId } = useAuth();
  return useQuery<number>({
    queryKey: unreadKey(userId ?? ""),
    queryFn: () => fetchUnreadCount(userId!),
    enabled: !!userId,
    staleTime: STALE.me,
  });
}

// 종 배지 전용. 같은 쿼리를 보되 **주기 폴링을 여기에만** 건다.
//
// 타이머를 쿼리가 아니라 옵저버가 들고 있어서(TanStack 은 refetchInterval 을 useQuery 호출마다
// setInterval 로 건다), 종이 여러 벌 떠 있으면 1분에 그만큼 요청이 나간다. 그런데 앱 헤더는
// 화면 셸(components/screen.tsx)마다 그려지고 스택·탭에 쌓인 화면은 마운트된 채 남으므로,
// 탭 네 개를 거쳐 화면 하나를 더 밀면 같은 개수 조회가 분당 대여섯 번이 된다. useIsFocused 로
// **지금 보고 있는 화면의 종만** 타이머를 돌린다(웹은 종이 레이아웃에 하나뿐이라 없던 문제다).
//
// 포그라운드 조건은 그 위에 하나 더 있다: refetchIntervalInBackground 기본값이 false 고
// focusManager 가 AppState 에 묶여 있어(lib/query-client.ts) 앱이 백그라운드면 타이머가 멈춘다 —
// 웹이 document.visibilityState 로 거르는 것과 같은 자리다. 비로그인은 enabled:false 라 폴링이
// 아예 돌지 않는다(게스트에게는 종 자체를 그리지 않는다 — 웹과 동일).
export function useUnreadNotificationBadge() {
  const { userId } = useAuth();
  const focused = useIsFocused();
  return useQuery<number>({
    queryKey: unreadKey(userId ?? ""),
    queryFn: () => fetchUnreadCount(userId!),
    enabled: !!userId,
    staleTime: STALE.me,
    refetchInterval: focused ? POLL_INTERVAL_MS : false,
  });
}

// 종을 열었을 때의 최근 8건. 열기 전에는 부르지 않는다(enabled).
export function useNotificationBellFeed(enabled: boolean) {
  const { userId } = useAuth();
  return useQuery<NotificationPage>({
    queryKey: bellKey(userId ?? ""),
    queryFn: () => fetchNotifications(userId!, { limit: NOTIFICATION_DROPDOWN_SIZE }),
    enabled: enabled && !!userId,
    staleTime: STALE.me,
  });
}

// `/notifications` 한 페이지(20건).
export function useNotificationPage(page: number) {
  const { userId } = useAuth();
  return useQuery<NotificationPage>({
    queryKey: pageKey(userId ?? "", page),
    queryFn: () =>
      fetchNotifications(userId!, {
        limit: NOTIFICATIONS_PAGE_SIZE,
        offset: (page - 1) * NOTIFICATIONS_PAGE_SIZE,
      }),
    enabled: !!userId,
    staleTime: STALE.me,
  });
}

// plpgsql `raise exception` 의 SQLSTATE. 함수가 일부러 던진 오류만 이 코드로 오고 그 message 가
// 곧 화면 문구다(data/reports.ts 와 같은 규칙) — 화면은 이 Error.message 를 그대로 그린다
// (app/notifications/index.tsx·components/notifications/notification-bell.tsx). 그 밖의
// 실패(함수 미적용 PGRST202·네트워크)는 사용자에게 보여줄 말이 아니라 한 문장으로 덮는다.
const RAISE_EXCEPTION = "P0001";

async function callVoidRpc(fn: string, args: Record<string, unknown>, fallback: string): Promise<void> {
  const { error } = await supabase.rpc(fn, args);
  if (!error) return;
  throw new Error(error.code === RAISE_EXCEPTION && error.message ? error.message : fallback);
}

// 지금 떠 있는 모든 알림 목록(종·페이지)에 같은 변경을 적용한다.
function patchLists(
  queryClient: QueryClient,
  userId: string,
  map: (items: NotificationItem[]) => NotificationItem[],
): void {
  queryClient.setQueriesData<NotificationPage>({ queryKey: listsKey(userId) }, (prev) =>
    prev ? { ...prev, items: map(prev.items) } : prev,
  );
}

function patchUnread(queryClient: QueryClient, userId: string, map: (n: number) => number): void {
  queryClient.setQueryData<number>(unreadKey(userId), (prev) => (prev === undefined ? prev : map(prev)));
}

// 뮤테이션 실패 문구. 세 훅 모두 callVoidRpc 가 이미 사람이 읽을 문장으로 바꿔 던지므로
// 화면은 먼저 실패한 것 하나를 골라 그리기만 한다.
export function notificationActionError(...errors: unknown[]): string | null {
  const failed = errors.find((e) => e instanceof Error);
  return failed instanceof Error ? failed.message : null;
}

// 한 건 읽음. 웹과 같이 **결과를 기다리지 않는다** — 화면은 바로 읽음으로 바뀌고 이동한다.
// 성공했다면 서버 상태가 이미 낙관적 값과 같으므로 다시 조회하지 않고, 실패했을 때만
// 무효화해 진짜 상태로 되돌린다(1분 폴링이 도는 자리라 왕복을 아낀다).
//
// 이 실패만은 문구를 띄우지 않는다(웹 notification-bell.tsx 도 결과를 버린다): 사용자가 누른
// 것은 "읽음"이 아니라 "열기"라, 이동한 화면 위에 읽음 처리 실패 경고를 얹으면 방해만 된다.
// 되돌아온 안 읽음 점이 곧 결과고, 다시 누르면 다시 시도된다.
export function useMarkNotificationRead() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callVoidRpc("mark_notification_read", { p_id: id }, "알림을 읽음으로 표시하지 못했어요."),
    onMutate: (id) => {
      if (!userId) return;
      patchLists(queryClient, userId, (items) =>
        items.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      );
      patchUnread(queryClient, userId, (n) => Math.max(0, n - 1));
    },
    onError: () => {
      if (userId) void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
    },
  });
}

// 모두 읽음. 서버가 읽음 처리와 함께 **60일 초과 읽음 알림을 지우므로**(RPC 안의 prune —
// 웹 pruneReadNotifications 와 같은 기준) 끝나면 반드시 다시 읽는다. 낙관적 값만 믿으면
// 방금 사라진 오래된 줄이 화면에 남는다(웹의 router.refresh() 자리).
export function useMarkAllNotificationsRead() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      callVoidRpc("mark_all_notifications_read", {}, "알림을 모두 읽음으로 표시하지 못했어요."),
    onMutate: () => {
      if (!userId) return;
      patchLists(queryClient, userId, (items) => items.map((n) => ({ ...n, isRead: true })));
      patchUnread(queryClient, userId, () => 0);
    },
    onSettled: () => {
      if (userId) void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
    },
  });
}

// 한 건 삭제(목록 화면에만 있는 동작 — 종에는 그 자리가 없다, 웹과 동일).
// 지우면 뒤 페이지가 한 칸씩 당겨지고 total 이 줄어 페이지 수가 바뀔 수 있으므로 다시 읽는다.
export function useDeleteNotification() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callVoidRpc("delete_notification", { p_id: id }, "알림을 삭제하지 못했어요."),
    onMutate: (id) => {
      if (!userId) return;
      const wasUnread = queryClient
        .getQueriesData<NotificationPage>({ queryKey: listsKey(userId) })
        .some(([, page]) => page?.items.some((n) => n.id === id && !n.isRead));
      patchLists(queryClient, userId, (items) => items.filter((n) => n.id !== id));
      if (wasUnread) patchUnread(queryClient, userId, (n) => Math.max(0, n - 1));
    },
    onSettled: () => {
      if (userId) void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) });
    },
  });
}
