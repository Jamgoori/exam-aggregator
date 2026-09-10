"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionClaims, getSessionUser } from "@/lib/supabase/session";
import {
  fetchNotifications,
  NOTIFICATION_DROPDOWN_SIZE,
  pruneReadNotifications,
} from "@/lib/notifications";
import type { NotificationItem } from "@gongmoa/core";

// 헤더의 종 아이콘이 부르는 액션들. 종은 클라이언트 컴포넌트라(레이아웃에 살아남아
// 페이지 이동과 무관하게 상태를 들고 있다) 서버 컴포넌트로 데이터를 내려줄 수 없어,
// 마운트 시점과 주기적으로 이 액션을 부른다.

export type NotificationFeed = {
  items: NotificationItem[];
  unread: number;
  loggedIn: boolean;
};

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// 종을 열었을 때의 목록 + 안 읽은 개수. 목록까지 같이 주는 이유는, 열자마자
// 스피너를 보여주지 않으려는 것이다(개수만 먼저 받아오는 왕복을 한 번 아낀다).
export async function loadNotificationFeed(): Promise<NotificationFeed> {
  const { user } = await getSessionUser();
  if (!user) return { items: [], unread: 0, loggedIn: false };

  const { items, unread } = await fetchNotifications(user.id, {
    limit: NOTIFICATION_DROPDOWN_SIZE,
  });
  return { items, unread, loggedIn: true };
}

// 배지 숫자만 갱신하는 가벼운 조회(주기 폴링용). 목록을 같이 실어 보내면
// 1분마다 알림 8건이 왕복한다.
export async function loadUnreadCount(): Promise<number> {
  // 1분마다 도는 폴링이라 인증 서버 왕복(getUser) 대신 JWT 로컬 검증으로 식별한다.
  const { claims } = await getSessionClaims();
  if (!claims) return 0;
  const user = { id: claims.sub };

  const admin = createAdminClient();
  const { count } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);
  return count ?? 0;
}

export async function markNotificationRead(id: string): Promise<{ error?: string }> {
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인이 필요해요." };

  const admin = createAdminClient();
  // user_id 조건을 함께 건다 — id 만으로 갱신하면 남의 알림을 읽음 처리할 수 있다.
  await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("read_at", null);

  revalidatePath("/notifications");
  return {};
}

export async function markAllNotificationsRead(): Promise<{ error?: string }> {
  const { user } = await getSessionUser();
  if (!user) return { error: "로그인이 필요해요." };

  const admin = createAdminClient();
  await admin
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);

  // 다 읽은 김에 오래된 것을 정리한다. 알림은 계속 쌓이기만 하는 표라, 어딘가
  // 한 곳에서는 치워야 목록이 몇 년 치로 늘어나지 않는다.
  await pruneReadNotifications(user.id);

  revalidatePath("/notifications");
  return {};
}

export async function deleteNotification(id: string): Promise<{ error?: string }> {
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인이 필요해요." };

  const admin = createAdminClient();
  await admin.from("notifications").delete().eq("id", id).eq("user_id", user.id);

  revalidatePath("/notifications");
  return {};
}
