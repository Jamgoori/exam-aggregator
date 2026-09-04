import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  richTextToPlain,
  type NotificationItem,
  type NotificationType,
} from "@gongmoa/core";

// 알림 읽기·쓰기. 규칙(종류·문구)은 packages/core/src/notifications.ts 에 있다.
//
// notifications 는 "본인 것만 select" RLS 지만, 여기서는 서버가 이미 세션 사용자를
// 확정한 뒤 그 id 로만 조회하므로 admin 클라이언트를 쓴다(다른 게시판 조회와 같은
// 방식 — 화면마다 세션 클라이언트를 만들지 않아도 되고, 조건이 코드에 드러난다).

export const NOTIFICATIONS_PAGE_SIZE = 20;
// 드롭다운에 한 번에 보여주는 개수. 더 보려면 /notifications 로 간다.
export const NOTIFICATION_DROPDOWN_SIZE = 8;

// 알림 미리보기에 싣는 본문 길이. 길게 실으면 드롭다운이 한 화면을 넘긴다.
const PREVIEW_MAX = 80;

export function notificationPreview(content: string): string {
  const flat = richTextToPlain(content).replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX)}…` : flat;
}

type CreateNotificationInput = {
  // 받는 사람.
  userId: string;
  type: NotificationType;
  actorId: string;
  actorNickname: string;
  title: string;
  preview: string;
  link: string;
};

// 알림 한 건 만들기.
//
// **실패해도 던지지 않는다.** 이 함수를 부르는 자리는 전부 "댓글을 달았다" 같은
// 본 동작의 끝자락인데, 알림 insert 하나가 실패했다고 그 동작을 실패로 되돌리면
// 사용자는 댓글이 안 달린 줄 알고 다시 쓴다(그리고 그때는 댓글이 두 개가 된다).
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  // 내가 내 글에 단 댓글로 나에게 알림이 오면 그건 잡음이다.
  if (input.userId === input.actorId) return;

  try {
    const admin = createAdminClient();
    await admin.from("notifications").insert({
      user_id: input.userId,
      type: input.type,
      actor_id: input.actorId,
      actor_nickname: input.actorNickname,
      title: input.title.slice(0, 100),
      preview: input.preview,
      link: input.link,
    });
  } catch {
    // 위 주석 참고 — 알림은 곁다리다.
  }
}

// 여러 사람에게 같은 알림을 보낼 때(같은 댓글에 참여한 사람들 등). 중복 대상과
// 본인은 여기서 걸러진다.
export async function createNotifications(
  userIds: readonly string[],
  input: Omit<CreateNotificationInput, "userId">,
): Promise<void> {
  const targets = [...new Set(userIds.filter((id) => id && id !== input.actorId))];
  if (targets.length === 0) return;

  try {
    const admin = createAdminClient();
    await admin.from("notifications").insert(
      targets.map((userId) => ({
        user_id: userId,
        type: input.type,
        actor_id: input.actorId,
        actor_nickname: input.actorNickname,
        title: input.title.slice(0, 100),
        preview: input.preview,
        link: input.link,
      })),
    );
  } catch {
    // 위와 같은 이유로 삼킨다.
  }
}

function toItem(row: Record<string, unknown>): NotificationItem {
  return {
    id: row.id as string,
    type: row.type as NotificationType,
    actorNickname: row.actor_nickname as string,
    title: row.title as string,
    preview: (row.preview as string) ?? "",
    link: row.link as string,
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
