"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { getSuggestionViewer } from "@/lib/suggestions";
import {
  canDeleteSuggestion,
  canDeleteSuggestionComment,
  canEditSuggestion,
  canEditSuggestionComment,
  canPinSuggestion,
  canReadSuggestion,
  NICKNAME_MAX,
  validateSuggestionAnswer,
  validateSuggestionCommentContent,
  validateSuggestionInput,
  type SuggestionViewer,
} from "@gongmoa/core";

export type SuggestionResult = { error?: string; success?: boolean; id?: string };

// 한 계정이 짧은 시간에 게시판을 도배하는 것만 막는 느슨한 상한. 정상적인 건의는
// 하루에 몇 건을 넘지 않는다 (문항 오류 신고와 같은 기준).
const HOURLY_LIMIT = 10;
// 댓글은 원글보다 가볍게 자주 오가므로 더 넉넉히 잡는다.
const COMMENT_HOURLY_LIMIT = 30;

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// 목록·상세 어느 쪽에서 글을 고쳐도 두 화면이 같이 최신이 되게 한다.
function revalidateSuggestion(id?: string) {
  revalidatePath("/suggestions");
  if (id) revalidatePath(`/suggestions/${id}`);
}

// 클라이언트가 보낸 isPinned/isSecret 을 서버가 다시 확정한다. 체크박스는 비관리자
// 화면에서 아예 지워두지만, 폼 데이터를 직접 조작해 보내는 경로는 여기서 막아야
// 실제로 지켜진다("관리자만 고정할 수 있다" — canPinSuggestion). 공지는 성격상
// 비밀글일 이유가 없어, 고정되는 글은 비밀글 여부를 강제로 끈다.
function resolvePinAndSecret(
  input: { isSecret: boolean; isPinned: boolean },
  viewer: SuggestionViewer,
) {
  const isPinned = canPinSuggestion(viewer) && input.isPinned === true;
  const isSecret = isPinned ? false : input.isSecret === true;
  return { isPinned, isSecret };
}

export async function createSuggestion(input: {
  title: string;
  content: string;
  isSecret: boolean;
  isPinned?: boolean;
}): Promise<SuggestionResult> {
  const validated = validateSuggestionInput(input);
  if ("error" in validated) return { error: validated.error };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { data: isAdminData } = await supabase.rpc("is_admin");
  const viewer: SuggestionViewer = { userId: user.id, isAdmin: isAdminData === true };
  const { isPinned, isSecret } = resolvePinAndSecret(
    { isSecret: input.isSecret, isPinned: input.isPinned ?? false },
    viewer,
  );

  const admin = createAdminClient();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("suggestions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneHourAgo);
  if ((count ?? 0) >= HOURLY_LIMIT) {
    return { error: "짧은 시간 동안 너무 많이 작성했어요. 잠시 후 다시 시도해주세요." };
  }

  // 작성자명은 세션에서만 가져온다 — 클라이언트가 보내는 이름을 믿으면 남의
  // 이름으로 글을 쓸 수 있다. 화면에 보이는 닉네임의 원본은
  // auth.users.raw_user_meta_data.nickname 이고(schema.sql 참고) profiles 는
  // 중복 판별용 그림자 원장이라, 댓글과 같은 순서로 읽는다.
  const nickname =
    (user.user_metadata?.nickname as string | undefined) ??
    user.email?.split("@")[0] ??
    "회원";

  const { data, error } = await admin
    .from("suggestions")
    .insert({
      user_id: user.id,
      nickname: nickname.slice(0, NICKNAME_MAX),
      title: validated.title,
      content: validated.content,
      is_secret: isSecret,
      is_pinned: isPinned,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "등록에 실패했어요." };

  revalidateSuggestion(data.id as string);
  return { success: true, id: data.id as string };
}

export async function updateSuggestion(input: {
  id: string;
  title: string;
  content: string;
  isSecret: boolean;
  isPinned?: boolean;
}): Promise<SuggestionResult> {
  const id = String(input.id ?? "");
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const validated = validateSuggestionInput(input);
  if ("error" in validated) return { error: validated.error };

  const viewer = await getSuggestionViewer();
  if (!viewer.loggedIn) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: post } = await admin
    .from("suggestions")
    .select("user_id, is_secret")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요." };

  if (!canEditSuggestion({ user_id: post.user_id as string, is_secret: post.is_secret as boolean }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { isPinned, isSecret } = resolvePinAndSecret(
    { isSecret: input.isSecret, isPinned: input.isPinned ?? false },
    viewer,
  );

  const { error } = await admin
    .from("suggestions")
    .update({
      title: validated.title,
      content: validated.content,
      is_secret: isSecret,
      is_pinned: isPinned,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: "수정에 실패했어요." };

  revalidateSuggestion(id);
  return { success: true, id };
}

export async function deleteSuggestion(id: string): Promise<SuggestionResult> {
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const viewer = await getSuggestionViewer();
  if (!viewer.loggedIn) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: post } = await admin
    .from("suggestions")
    .select("user_id, is_secret")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요." };

  if (!canDeleteSuggestion({ user_id: post.user_id as string, is_secret: post.is_secret as boolean }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { error } = await admin.from("suggestions").delete().eq("id", id);
  if (error) return { error: "삭제에 실패했어요." };

  revalidateSuggestion(id);
  return { success: true };
}

// 관리자 답변 등록/수정. 답변은 본문과 별도 컬럼이라 원글은 그대로 남는다.
export async function answerSuggestion(input: {
  id: string;
  answer: string;
}): Promise<SuggestionResult> {
  const id = String(input.id ?? "");
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const validated = validateSuggestionAnswer(input.answer);
  if ("error" in validated) return { error: validated.error };

  const viewer = await getSuggestionViewer();
  if (!viewer.isAdmin) return { error: "권한이 없어요." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("suggestions")
    .update({
      answer: validated.answer,
      answered_at: new Date().toISOString(),
      answered_by: viewer.userId,
    })
    .eq("id", id);
  if (error) return { error: "답변 등록에 실패했어요." };

  revalidateSuggestion(id);
  return { success: true, id };
}

export async function createSuggestionComment(input: {
  suggestionId: string;
  content: string;
}): Promise<SuggestionResult> {
  const suggestionId = String(input.suggestionId ?? "");
  if (!isUuid(suggestionId)) return { error: "잘못된 접근입니다." };

  const validated = validateSuggestionCommentContent(input.content);
  if ("error" in validated) return { error: validated.error };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();

  const { data: post } = await admin
    .from("suggestions")
    .select("user_id, is_secret")
    .eq("id", suggestionId)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요." };

  // 댓글은 원글을 볼 수 있는 사람만 달 수 있다 — 여기서 다시 확인하지 않으면
  // 비밀글의 id를 알아낸 사람이 본문은 못 봐도 댓글로 흔적을 남길 수 있다.
  const { data: isAdminData } = await supabase.rpc("is_admin");
  const viewer: SuggestionViewer = { userId: user.id, isAdmin: isAdminData === true };
  if (!canReadSuggestion({ user_id: post.user_id as string, is_secret: post.is_secret as boolean }, viewer)) {
    return { error: "잘못된 접근입니다." };
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("suggestion_comments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneHourAgo);
  if ((count ?? 0) >= COMMENT_HOURLY_LIMIT) {
    return { error: "짧은 시간 동안 너무 많이 작성했어요. 잠시 후 다시 시도해주세요." };
  }

  const nickname =
    (user.user_metadata?.nickname as string | undefined) ??
    user.email?.split("@")[0] ??
    "회원";

  const { error } = await admin.from("suggestion_comments").insert({
    suggestion_id: suggestionId,
    user_id: user.id,
    nickname: nickname.slice(0, NICKNAME_MAX),
    content: validated.content,
  });
  if (error) return { error: "댓글 등록에 실패했어요." };

  revalidateSuggestion(suggestionId);
  return { success: true, id: suggestionId };
}

export async function updateSuggestionComment(input: {
  commentId: string;
  content: string;
}): Promise<SuggestionResult> {
  const commentId = String(input.commentId ?? "");
  if (!isUuid(commentId)) return { error: "잘못된 접근입니다." };

  const validated = validateSuggestionCommentContent(input.content);
  if ("error" in validated) return { error: validated.error };

  const viewer = await getSuggestionViewer();
  if (!viewer.loggedIn) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: comment } = await admin
    .from("suggestion_comments")
    .select("suggestion_id, user_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { error: "댓글을 찾을 수 없어요." };

  if (!canEditSuggestionComment({ user_id: comment.user_id as string }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { error } = await admin
    .from("suggestion_comments")
    .update({ content: validated.content, updated_at: new Date().toISOString() })
    .eq("id", commentId);
  if (error) return { error: "수정에 실패했어요." };

  revalidateSuggestion(comment.suggestion_id as string);
  return { success: true, id: comment.suggestion_id as string };
}

export async function deleteSuggestionComment(commentId: string): Promise<SuggestionResult> {
  if (!isUuid(commentId)) return { error: "잘못된 접근입니다." };

  const viewer = await getSuggestionViewer();
  if (!viewer.loggedIn) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: comment } = await admin
    .from("suggestion_comments")
    .select("suggestion_id, user_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { error: "댓글을 찾을 수 없어요." };

  if (!canDeleteSuggestionComment({ user_id: comment.user_id as string }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { error } = await admin.from("suggestion_comments").delete().eq("id", commentId);
  if (error) return { error: "삭제에 실패했어요." };

  revalidateSuggestion(comment.suggestion_id as string);
  return { success: true };
}
