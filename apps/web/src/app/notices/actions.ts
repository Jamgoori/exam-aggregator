"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  authorNickname,
  canDeleteNoticeComment,
  canEditNoticeComment,
  validateNoticeCommentContent,
  validateNoticeInput,
  type NoticeViewer,
} from "@gongmoa/core";

export type NoticeResult = { error?: string; success?: boolean; id?: string };

// 댓글은 원글 하나에 여러 건 도배될 수 있어 시간당 상한을 둔다(suggestion_comments와
// 같은 기준). 원글(관리자 전용 작성)은 관리자만 쓰는 데다 자기 사이트 공지라
// 도배 걱정이 없어 별도 상한이 없다.
const COMMENT_HOURLY_LIMIT = 30;

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// 목록·상세 어느 쪽에서 글을 고쳐도 두 화면이 같이 최신이 되게 한다.
function revalidateNotice(id?: string) {
  revalidatePath("/notices");
  if (id) revalidatePath(`/notices/${id}`);
}

// 쓰기는 RLS(is_admin)가 최종 방어선이지만, 여기서 먼저 끊어야 관리자가 아닌
// 계정에게는 "권한이 없어요"라는 명확한 메시지를 돌려줄 수 있다(admin/actions.ts
// requireAdmin과 같은 이유).
async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) return { error: "관리자만 사용할 수 있어요." };
  return { user };
}

export async function createNotice(input: {
  title: string;
  content: string;
  isPinned?: boolean;
}): Promise<NoticeResult> {
  const validated = validateNoticeInput(input);
  if ("error" in validated) return { error: validated.error };

  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if ("error" in auth) return { error: auth.error };

  const { data, error } = await supabase
    .from("notices")
    .insert({
      title: validated.title,
      content: validated.content,
      is_pinned: input.isPinned === true,
      created_by: auth.user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "등록에 실패했어요." };

  revalidateNotice(data.id as string);
  return { success: true, id: data.id as string };
}

export async function updateNotice(input: {
  id: string;
  title: string;
  content: string;
  isPinned?: boolean;
}): Promise<NoticeResult> {
  const id = String(input.id ?? "");
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const validated = validateNoticeInput(input);
  if ("error" in validated) return { error: validated.error };

  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if ("error" in auth) return { error: auth.error };

  const { error } = await supabase
    .from("notices")
    .update({
      title: validated.title,
      content: validated.content,
      is_pinned: input.isPinned === true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: "수정에 실패했어요." };

  revalidateNotice(id);
  return { success: true, id };
}

export async function deleteNotice(id: string): Promise<NoticeResult> {
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if ("error" in auth) return { error: auth.error };

  const { error } = await supabase.from("notices").delete().eq("id", id);
  if (error) return { error: "삭제에 실패했어요." };

  revalidateNotice(id);
  return { success: true };
}

// ── 댓글 ─────────────────────────────────────────────────────────────────────
// 원글(제목·내용)은 관리자만 쓸 수 있지만, 댓글은 반대로 로그인 회원이면 누구나
// 달 수 있다 — RLS(insert own notice_comments)가 최종 방어선이고, 여기서는 그
// 전에 도배 방지와 닉네임 확정만 한다.

export async function createNoticeComment(input: {
  noticeId: string;
  content: string;
}): Promise<NoticeResult> {
  const noticeId = String(input.noticeId ?? "");
  if (!isUuid(noticeId)) return { error: "잘못된 접근입니다." };

  const validated = validateNoticeCommentContent(input.content);
  if ("error" in validated) return { error: validated.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("notice_comments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneHourAgo);
  if ((count ?? 0) >= COMMENT_HOURLY_LIMIT) {
    return { error: "짧은 시간 동안 너무 많이 작성했어요. 잠시 후 다시 시도해주세요." };
  }

  // 이메일 로컬파트로 떨어지지 않는다 — 그 값은 닉네임 정책(금칙어·중복)을 지나간
  // 적이 없어서 "관리자" 같은 이름이 그대로 박힌다(core의 authorNickname 주석 참고).
  const nickname = authorNickname(user.user_metadata?.nickname);

  const { error } = await supabase.from("notice_comments").insert({
    notice_id: noticeId,
    user_id: user.id,
    nickname,
    content: validated.content,
  });
  if (error) return { error: "댓글 등록에 실패했어요." };

  revalidateNotice(noticeId);
  return { success: true, id: noticeId };
}

export async function updateNoticeComment(input: {
  commentId: string;
  content: string;
}): Promise<NoticeResult> {
  const commentId = String(input.commentId ?? "");
  if (!isUuid(commentId)) return { error: "잘못된 접근입니다." };

  const validated = validateNoticeCommentContent(input.content);
  if ("error" in validated) return { error: validated.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { data: comment } = await supabase
    .from("notice_comments")
    .select("notice_id, user_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { error: "댓글을 찾을 수 없어요." };

  const viewer: NoticeViewer = { userId: user.id, isAdmin: false };
  if (!canEditNoticeComment({ user_id: comment.user_id as string }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { error } = await supabase
    .from("notice_comments")
    .update({ content: validated.content, updated_at: new Date().toISOString() })
    .eq("id", commentId);
  if (error) return { error: "수정에 실패했어요." };

  revalidateNotice(comment.notice_id as string);
  return { success: true, id: comment.notice_id as string };
}

export async function deleteNoticeComment(commentId: string): Promise<NoticeResult> {
  if (!isUuid(commentId)) return { error: "잘못된 접근입니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { data: comment } = await supabase
    .from("notice_comments")
    .select("notice_id, user_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { error: "댓글을 찾을 수 없어요." };

  const { data: isAdminData } = await supabase.rpc("is_admin");
  const viewer: NoticeViewer = { userId: user.id, isAdmin: isAdminData === true };
  if (!canDeleteNoticeComment({ user_id: comment.user_id as string }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { error } = await supabase.from("notice_comments").delete().eq("id", commentId);
  if (error) return { error: "삭제에 실패했어요." };

  revalidateNotice(comment.notice_id as string);
  return { success: true };
}
