import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canDeleteNoticeComment,
  canEditNoticeComment,
  validateNoticeCommentContent,
  type NoticeViewer,
} from "../notices";
import { authorNickname } from "../nickname";
import { isPaperUuid } from "../paper-slug";
import { HOURLY_LIMIT_ERROR, NOTICE_COMMENT_HOURLY_LIMIT, overHourlyLimit } from "./hourly-limit";

// 공지 댓글 쓰기 규칙. 웹 서버 액션(app/notices/actions.ts)과 Edge Function(notices-write)이
// 이 세 함수의 어댑터다. 공지 **원글**의 작성·수정·삭제는 관리자 전용이라 앱에 없고(설계서
// §5 — /notices/new·edit 는 AASA 제외), 여기에도 없다.
//
// 웹은 지금까지 세션 클라이언트 + RLS("insert own"·"update own"·"delete own or admin")로
// 썼다. 규칙은 어느 클라이언트로 불려도 같은 결과여야 하므로 **본문에 소유자 조건을 명시**한다
// — admin(service_role) 클라이언트로 부르면 RLS 가 없어서, `eq("user_id", …)` 를 빠뜨리면 id 만
// 아는 남의 댓글에 손이 닿는다. SD RPC 공통 규칙 (3)(설계서 §6.7 머리말)과 같은 이유다.

export type NoticeActor = NoticeViewer & {
  userId: string;
  // user_metadata.nickname 원본(rules/board.ts 와 같은 처리).
  metadataNickname?: unknown;
};

// 400 잘못된 입력   403 남의 댓글   404 댓글 없음   429 시간당 한도   500 저장 실패
export type NoticeRuleError = { error: string; status: 400 | 403 | 404 | 429 | 500 };

export type NoticeDeps = { now?: () => Date };

function nowOf(deps: NoticeDeps): Date {
  return deps.now ? deps.now() : new Date();
}

export async function createNoticeComment(
  client: SupabaseClient,
  input: { actor: NoticeActor; noticeId: string; content: string },
  deps: NoticeDeps = {},
): Promise<NoticeRuleError | { id: string }> {
  const noticeId = String(input.noticeId ?? "");
  if (!isPaperUuid(noticeId)) return { error: "잘못된 접근입니다.", status: 400 };

  const validated = validateNoticeCommentContent(input.content);
  if ("error" in validated) return { error: validated.error, status: 400 };

  if (await overHourlyLimit(client, "notice_comments", input.actor.userId, NOTICE_COMMENT_HOURLY_LIMIT, nowOf(deps))) {
    return { error: HOURLY_LIMIT_ERROR, status: 429 };
  }

  // 이메일 로컬파트로 떨어지지 않는다 — 그 값은 닉네임 정책(금칙어·중복)을 지나간 적이
  // 없어서 "관리자" 같은 이름이 그대로 박힌다(../nickname.ts authorNickname 주석).
  const nickname = authorNickname(await resolveNickname(client, input.actor));

  // 공지가 없으면 FK 위반으로 insert 가 실패한다 — 웹도 따로 확인하지 않고 같은 문구를 낸다.
  const { error } = await client.from("notice_comments").insert({
    notice_id: noticeId,
    user_id: input.actor.userId,
    nickname,
    content: validated.content,
  });
  if (error) return { error: "댓글 등록에 실패했어요.", status: 500 };

  return { id: noticeId };
}

export async function updateNoticeComment(
  client: SupabaseClient,
  input: { actor: NoticeActor; commentId: string; content: string },
  deps: NoticeDeps = {},
): Promise<NoticeRuleError | { id: string }> {
  const commentId = String(input.commentId ?? "");
  if (!isPaperUuid(commentId)) return { error: "잘못된 접근입니다.", status: 400 };

  const validated = validateNoticeCommentContent(input.content);
  if ("error" in validated) return { error: validated.error, status: 400 };

  const { data: comment } = await client
    .from("notice_comments")
    .select("notice_id, user_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { error: "댓글을 찾을 수 없어요.", status: 404 };

  // 수정은 작성자 본인만 — 관리자에게도 열지 않는다(../notices.ts canEditNoticeComment).
  if (!canEditNoticeComment({ user_id: comment.user_id as string | null }, input.actor)) {
    return { error: "권한이 없어요.", status: 403 };
  }

  const { error } = await client
    .from("notice_comments")
    .update({ content: validated.content, updated_at: nowOf(deps).toISOString() })
    .eq("id", commentId)
    // 위에서 확인했지만 쓰기 문장에도 소유자를 박는다 — 읽기와 쓰기 사이의 경합·admin 클라이언트
    // 양쪽에 대한 방어선이다.
    .eq("user_id", input.actor.userId);
  if (error) return { error: "수정에 실패했어요.", status: 500 };

  return { id: comment.notice_id as string };
}

export async function deleteNoticeComment(
  client: SupabaseClient,
  input: { actor: NoticeActor; commentId: string },
): Promise<NoticeRuleError | { id: string }> {
  const commentId = String(input.commentId ?? "");
  if (!isPaperUuid(commentId)) return { error: "잘못된 접근입니다.", status: 400 };

  const { data: comment } = await client
    .from("notice_comments")
    .select("notice_id, user_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { error: "댓글을 찾을 수 없어요.", status: 404 };

  // 삭제는 본인 + 관리자(스팸·욕설 정리).
  if (!canDeleteNoticeComment({ user_id: comment.user_id as string | null }, input.actor)) {
    return { error: "권한이 없어요.", status: 403 };
  }

  // 관리자는 남의 댓글을 지울 수 있으므로 소유자 조건은 관리자가 아닐 때만 붙인다.
  let query = client.from("notice_comments").delete().eq("id", commentId);
  if (!input.actor.isAdmin) query = query.eq("user_id", input.actor.userId);
  const { error } = await query;
  if (error) return { error: "삭제에 실패했어요.", status: 500 };

  return { id: comment.notice_id as string };
}

async function resolveNickname(client: SupabaseClient, actor: NoticeActor): Promise<unknown> {
  if (actor.metadataNickname !== undefined) return actor.metadataNickname;
  const { data } = await client.auth.admin.getUserById(actor.userId);
  return (data?.user?.user_metadata as { nickname?: unknown } | undefined)?.nickname;
}
