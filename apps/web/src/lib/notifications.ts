import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  NOTIFICATION_DROPDOWN_SIZE,
  NOTIFICATIONS_PAGE_SIZE,
  notificationPreview,
  safeNotificationLink,
  type NotificationItem,
  type NotificationType,
} from "@gongmoa/core";
import {
  createNotification as createNotificationRule,
  createNotifications as createNotificationsRule,
  type CreateNotificationInput,
} from "@gongmoa/core/server";

// 알림 읽기·쓰기. 규칙(종류·문구·한 페이지 개수·링크 검사·미리보기 길이)은
// packages/core/src/notifications.ts 에, 행을 만드는 쪽은 packages/core/src/rules/notify.ts 에
// 있다 — 이 파일은 `server-only` 라 앱이 import 할 수 없어서, 여기에 상수나 판정을 두면
// 앱이 같은 값을 다시 적어야 하고 그 사본이 조용히 어긋난다. Edge board-write 가 댓글 알림을
// 만들 때도 같은 규칙을 부른다.
//
// notifications 는 "본인 것만 select" RLS 지만, 여기서는 서버가 이미 세션 사용자를
// 확정한 뒤 그 id 로만 조회하므로 admin 클라이언트를 쓴다(다른 게시판 조회와 같은
// 방식 — 화면마다 세션 클라이언트를 만들지 않아도 되고, 조건이 코드에 드러난다).

// 화면·액션이 계속 `@/lib/notifications` 에서 가져가도록 core 값을 그대로 다시 내보낸다.
export { NOTIFICATION_DROPDOWN_SIZE, NOTIFICATIONS_PAGE_SIZE, notificationPreview };

// 알림 한 건 만들기 — 규칙(rules/notify.ts)의 어댑터. **실패해도 던지지 않는다**(규칙의 성질,
// docs/agents/board-rich-text.md §3). 부르는 자리(건의 댓글·답변)는 그대로다.
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await createNotificationRule(createAdminClient(), input);
}

// 여러 사람에게 같은 알림을 보낼 때. 중복 대상과 본인은 규칙이 걸러낸다.
export async function createNotifications(
  userIds: readonly string[],
  input: Omit<CreateNotificationInput, "userId">,
): Promise<void> {
  await createNotificationsRule(createAdminClient(), userIds, input);
}

function toItem(row: Record<string, unknown>): NotificationItem {
  return {
    id: row.id as string,
    type: row.type as NotificationType,
    actorNickname: row.actor_nickname as string,
    title: row.title as string,
    preview: (row.preview as string) ?? "",
    link: safeNotificationLink(row.link),
    isRead: row.read_at !== null,
    createdAt: row.created_at as string,
  };
}

export async function fetchNotifications(
  userId: string,
  { limit = NOTIFICATIONS_PAGE_SIZE, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<{ items: NotificationItem[]; total: number; unread: number }> {
  const admin = createAdminClient();

  const [{ data, count }, { count: unread }] = await Promise.all([
    admin
      .from("notifications")
      .select("id, type, actor_nickname, title, preview, link, read_at, created_at", {
        count: "exact",
      })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
  ]);

  return {
    items: (data ?? []).map((row) => toItem(row as Record<string, unknown>)),
    total: count ?? 0,
    unread: unread ?? 0,
  };
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  return count ?? 0;
}

// 오래된 알림 정리. 읽은 지 오래된 것만 지운다 — 안 읽은 알림은 몇 달이 지나도
// 사용자가 아직 못 본 것이라 함부로 지우면 안 된다.
export async function pruneReadNotifications(userId: string, keepDays = 60): Promise<void> {
  const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000).toISOString();
  try {
    const admin = createAdminClient();
    await admin
      .from("notifications")
      .delete()
      .eq("user_id", userId)
      .not("read_at", "is", null)
      .lt("created_at", cutoff);
  } catch {
    // 정리 실패는 화면에 영향이 없다.
  }
}
