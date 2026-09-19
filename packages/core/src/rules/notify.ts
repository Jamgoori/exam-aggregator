import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationType } from "../notifications";

// 알림 행 만들기 — DB 를 쓰는 쪽. 종류·문구·미리보기 길이·링크 검사 같은 순수 규칙은
// ../notifications.ts 에 있고, 여기는 그 규칙으로 notifications 표에 행을 넣는 일만 한다.
// 웹 lib/notifications.ts#createNotification 이 그대로 옮겨 온 것이다 — 앱이 Edge
// (board-write)로 댓글을 달면 그 사건의 알림도 여기서 만들어져야, 웹에서 단 댓글과
// 앱에서 단 댓글이 같은 모양의 알림을 남긴다.
//
// notifications 는 클라이언트에 select 만 열려 있어(schema.sql) 쓰기는 언제나 service_role
// 클라이언트로 한다.

export type CreateNotificationInput = {
  // 받는 사람.
  userId: string;
  type: NotificationType;
  actorId: string;
  actorNickname: string;
  title: string;
  preview: string;
  link: string;
};

// notifications.title 에 들어갈 최대 길이. 원글 제목 상한(게시판 100)과 같아서 보통은
// 자를 일이 없지만, 어떤 표의 제목이 실려 오든 여기서 한 번 더 막는다.
const TITLE_MAX = 100;

function toRow(input: CreateNotificationInput) {
  return {
    user_id: input.userId,
    type: input.type,
    actor_id: input.actorId || null,
    actor_nickname: input.actorNickname,
    title: input.title.slice(0, TITLE_MAX),
    preview: input.preview,
    link: input.link,
  };
}

// 알림 한 건 만들기.
//
// **실패해도 던지지 않는다.** 이 함수를 부르는 자리는 전부 "댓글을 달았다" 같은
// 본 동작의 끝자락인데, 알림 insert 하나가 실패했다고 그 동작을 실패로 되돌리면
// 사용자는 댓글이 안 달린 줄 알고 다시 쓴다(그리고 그때는 댓글이 두 개가 된다).
// docs/agents/board-rich-text.md §3 — 이 성질을 바꾸지 말 것.
export async function createNotification(
  client: SupabaseClient,
  input: CreateNotificationInput,
): Promise<void> {
  // 내가 내 글에 단 댓글로 나에게 알림이 오면 그건 잡음이다.
  if (input.userId === input.actorId) return;

  try {
    await client.from("notifications").insert(toRow(input));
  } catch {
    // 위 주석 참고 — 알림은 곁다리다.
  }
}

// 여러 사람에게 같은 알림을 보낼 때(같은 댓글에 참여한 사람들 등). 중복 대상과
// 본인은 여기서 걸러진다.
export async function createNotifications(
  client: SupabaseClient,
  userIds: readonly string[],
  input: Omit<CreateNotificationInput, "userId">,
): Promise<void> {
  const targets = [...new Set(userIds.filter((id) => id && id !== input.actorId))];
  if (targets.length === 0) return;

  try {
    await client
      .from("notifications")
      .insert(targets.map((userId) => toRow({ ...input, userId })));
  } catch {
    // 위와 같은 이유로 삼킨다.
  }
}
