"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { boardImageOrigin, getBoardViewer } from "@/lib/board";
import { createNotification, notificationPreview } from "@/lib/notifications";
import {
  authorNickname,
  canDeleteBoardComment,
  canDeleteBoardPost,
  canEditBoardComment,
  canEditBoardPost,
  canPinBoardPost,
  firstImageSrc,
  sanitizeRichText,
  validateBoardCommentContent,
  validateBoardPostInput,
  type BoardViewer,
} from "@gongmoa/core";

export type BoardResult = { error?: string; success?: boolean; id?: string };

// 한 계정이 게시판을 도배하는 것만 막는 느슨한 상한(건의게시판과 같은 기준).
const HOURLY_POST_LIMIT = 10;
const HOURLY_COMMENT_LIMIT = 30;
// 본문 이미지. 한 시간에 이만큼이면 사진 여러 장 붙인 글을 몇 개 써도 남는다.
const HOURLY_IMAGE_LIMIT = 60;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
// 본문 이미지의 가로 상한. 원본을 그대로 두면 4000px 짜리 사진이 목록·본문에
// 그대로 실려 나간다(모바일에서 그게 곧 데이터 요금이다).
const IMAGE_MAX_WIDTH = 1600;

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function revalidateBoard(id?: string) {
  revalidatePath("/board");
  if (id) revalidatePath(`/board/${id}`);
  // 검색엔진에 나가는 <head>(제목·설명)를 만드는 캐시도 같이 깨운다 — 안 깨우면
  // 새 글이 한동안 "제목 없는 셸"로 크롤러에게 나간다(lib/board.ts 주석).
  // "max" = stale-while-revalidate (예전 값을 즉시 주고 뒤에서 새로 받아 교체).
  revalidateTag("board-posts", "max");
}

// 시간당 작성 수 상한. 표 이름과 한도만 다르고 형태가 같아 한 곳으로 모았다.
async function overHourlyLimit(
  table: "board_posts" | "board_comments",
  userId: string,
  limit: number,
): Promise<boolean> {
  const admin = createAdminClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", oneHourAgo);
  return (count ?? 0) >= limit;
}

// ── 글 ──────────────────────────────────────────────────────────────────────

export async function createBoardPost(input: {
  title: string;
  category: string;
  // 에디터가 만든 원본 HTML. **여기서 새니타이즈하기 전에는 아무 데도 쓰지 않는다.**
  contentHtml: string;
  isPinned?: boolean;
}): Promise<BoardResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  // 순서가 중요하다: 새니타이즈 → 검증 → 저장. 검증을 원본에 대고 하면 "검사에는
  // 통과했는데 저장된 건 다른 것"이 되고, 그 틈이 곧 저장형 XSS 다.
  const sanitizedHtml = sanitizeRichText(input.contentHtml, {
    imageOrigins: [boardImageOrigin()],
  });
  const validated = validateBoardPostInput({
    title: input.title,
    category: input.category,
    sanitizedHtml,
  });
  if ("error" in validated) return { error: validated.error };

  const { data: isAdminData } = await supabase.rpc("is_admin");
  const viewer: BoardViewer = { userId: user.id, isAdmin: isAdminData === true };
  // 고정(공지)은 관리자만. 체크박스는 비관리자 화면에 아예 없지만, 폼 데이터를
  // 직접 만들어 보내는 경로를 여기서 막아야 실제로 지켜진다.
  const isPinned = canPinBoardPost(viewer) && input.isPinned === true;

  if (await overHourlyLimit("board_posts", user.id, HOURLY_POST_LIMIT)) {
    return { error: "짧은 시간 동안 너무 많이 작성했어요. 잠시 후 다시 시도해주세요." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("board_posts")
    .insert({
      user_id: user.id,
      // 작성자명은 세션에서만 가져온다 — 클라이언트가 보내는 이름을 믿으면 남의
      // 이름으로 글을 쓸 수 있다(건의게시판 주석 참고).
      nickname: authorNickname(user.user_metadata?.nickname),
      category: validated.category,
      title: validated.title,
      content_html: validated.contentHtml,
      content_text: validated.contentText,
      thumbnail_url: firstImageSrc(validated.contentHtml),
      is_pinned: isPinned,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "등록에 실패했어요." };

  revalidateBoard(data.id as string);
  return { success: true, id: data.id as string };
}

export async function updateBoardPost(input: {
  id: string;
  title: string;
  category: string;
  contentHtml: string;
  isPinned?: boolean;
}): Promise<BoardResult> {
  const id = String(input.id ?? "");
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const viewer = await getBoardViewer();
  if (!viewer.loggedIn) return { error: "로그인 후 이용할 수 있어요." };

  const sanitizedHtml = sanitizeRichText(input.contentHtml, {
    imageOrigins: [boardImageOrigin()],
  });
  const validated = validateBoardPostInput({
    title: input.title,
    category: input.category,
    sanitizedHtml,
  });
  if ("error" in validated) return { error: validated.error };

  const admin = createAdminClient();
  const { data: post } = await admin
    .from("board_posts")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요." };

  if (!canEditBoardPost({ user_id: post.user_id as string }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { error } = await admin
    .from("board_posts")
    .update({
      category: validated.category,
      title: validated.title,
      content_html: validated.contentHtml,
      content_text: validated.contentText,
      thumbnail_url: firstImageSrc(validated.contentHtml),
      // 고정 여부는 관리자가 고칠 때만 손댄다 — 비관리자가 자기 글을 수정할 때
      // 이 값을 같이 보내면 관리자가 걸어둔 공지 고정이 풀린다.
      ...(canPinBoardPost(viewer) ? { is_pinned: input.isPinned === true } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: "수정에 실패했어요." };

  revalidateBoard(id);
  return { success: true, id };
}

export async function deleteBoardPost(id: string): Promise<BoardResult> {
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const viewer = await getBoardViewer();
  if (!viewer.loggedIn) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: post } = await admin
    .from("board_posts")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요." };

  if (!canDeleteBoardPost({ user_id: post.user_id as string }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { error } = await admin.from("board_posts").delete().eq("id", id);
  if (error) return { error: "삭제에 실패했어요." };

  revalidateBoard(id);
  return { success: true };
}

// ── 좋아요 ──────────────────────────────────────────────────────────────────
// 개수는 트리거가 board_posts.like_count 에 유지한다(schema.sql).
export async function toggleBoardLike(
  postId: string,
): Promise<{ error?: string; liked?: boolean }> {
  if (!isUuid(postId)) return { error: "잘못된 접근입니다." };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("board_post_likes")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    await admin
      .from("board_post_likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user.id);
    revalidateBoard(postId);
    return { liked: false };
  }

  const { error } = await admin
    .from("board_post_likes")
    .insert({ post_id: postId, user_id: user.id });
  // 같은 글에 두 번 눌린 경합(23505)은 이미 눌린 것과 같은 결과다.
  if (error && error.code !== "23505") return { error: "잠시 후 다시 시도해주세요." };

  revalidateBoard(postId);
  return { liked: true };
}

// ── 이미지 업로드 ───────────────────────────────────────────────────────────
// 에디터의 "사진" 버튼이 부른다. 클라이언트가 버킷에 직접 올리지 않는 이유는
// 프로필 사진과 같다 — 크기·형식을 서버가 강제해야 하고, 그 관문을 우회할 수 있으면
// 강제가 아니다(schema.sql 의 board-images 버킷에 쓰기 정책이 없다).
export async function uploadBoardImage(
  formData: FormData,
): Promise<{ error?: string; url?: string }> {
  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "이미지를 선택해주세요." };
  if (!file.type.startsWith("image/")) return { error: "이미지 파일만 올릴 수 있어요." };
  if (file.size > IMAGE_MAX_BYTES) {
    return { error: `이미지는 ${IMAGE_MAX_BYTES / (1024 * 1024)}MB 이하로 올려주세요.` };
  }

  const admin = createAdminClient();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recent } = await admin.storage.from("board-images").list(user.id, {
    limit: HOURLY_IMAGE_LIMIT,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (
    (recent ?? []).filter((f) => (f.created_at ?? "") > oneHourAgo).length >= HOURLY_IMAGE_LIMIT
  ) {
    return { error: "짧은 시간 동안 이미지를 너무 많이 올렸어요. 잠시 후 다시 시도해주세요." };
  }

  let processed: Buffer;
  try {
    // withoutEnlargement: 작은 이미지를 억지로 키우지 않는다(키우면 흐려지기만 한다).
    // rotate(): 휴대폰 사진의 EXIF 회전을 실제 픽셀에 반영한다 — 안 하면 눕는다.
    processed = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    return { error: "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요." };
  }

  const path = `${user.id}/${crypto.randomUUID()}.webp`;
  const { error } = await admin.storage
    .from("board-images")
    .upload(path, processed, { contentType: "image/webp", cacheControl: "31536000" });
  if (error) return { error: "업로드에 실패했어요. 잠시 후 다시 시도해주세요." };

  return { url: `${boardImageOrigin()}${path}` };
}

// ── 댓글 ────────────────────────────────────────────────────────────────────

export async function createBoardComment(input: {
  postId: string;
  content: string;
  // 답글이면 대상 댓글 id. 답글에 다는 답글은 서버가 원 댓글로 접어 올린다.
  parentId?: string | null;
}): Promise<BoardResult> {
  const postId = String(input.postId ?? "");
  if (!isUuid(postId)) return { error: "잘못된 접근입니다." };

  const validated = validateBoardCommentContent(input.content);
  if ("error" in validated) return { error: validated.error };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: post } = await admin
    .from("board_posts")
    .select("user_id, title")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요." };

  if (await overHourlyLimit("board_comments", user.id, HOURLY_COMMENT_LIMIT)) {
    return { error: "짧은 시간 동안 너무 많이 작성했어요. 잠시 후 다시 시도해주세요." };
  }

  // 답글 대상 확인. 답글의 답글이면 그 부모(원 댓글)에 붙인다 — 깊이를 1단계로
  // 묶어두는 판단은 core 의 resolveBoardCommentParent 와 같은 규칙이다.
  let parentId: string | null = null;
  let parentAuthorId: string | null = null;
  const requestedParent = String(input.parentId ?? "");
  if (requestedParent) {
    if (!isUuid(requestedParent)) return { error: "잘못된 접근입니다." };
    const { data: parent } = await admin
      .from("board_comments")
      .select("id, parent_id, post_id, user_id, is_deleted")
      .eq("id", requestedParent)
      .maybeSingle();
    // 다른 글의 댓글 id 를 부모로 넘기는 경로를 막는다(트리가 글을 넘나들면 안 된다).
    if (!parent || parent.post_id !== postId) return { error: "답글을 달 댓글을 찾을 수 없어요." };
    parentId = (parent.parent_id as string | null) ?? (parent.id as string);
    parentAuthorId = parent.is_deleted ? null : (parent.user_id as string);
  }

  const nickname = authorNickname(user.user_metadata?.nickname);
  const { data: created, error } = await admin
    .from("board_comments")
    .insert({
      post_id: postId,
      parent_id: parentId,
      user_id: user.id,
      nickname,
      content: validated.content,
    })
    .select("id")
    .single();
  if (error || !created) return { error: "댓글 등록에 실패했어요." };

  // 알림. 답글이면 원 댓글 작성자에게, 아니면 글쓴이에게 보낸다. 답글이 원글에
  // 달린 것이기도 하므로 글쓴이에게도 알린다(둘이 같은 사람이면 한 번만 — 아래
  // createNotification 이 본인 알림을 걸러낸다).
  const link = `/board/${postId}#comment-${created.id as string}`;
  const preview = notificationPreview(validated.content);
  const title = post.title as string;

  if (parentAuthorId) {
    await createNotification({
      userId: parentAuthorId,
      type: "board_reply",
      actorId: user.id,
      actorNickname: nickname,
      title,
      preview,
      link,
    });
  }
  if (post.user_id !== parentAuthorId) {
    await createNotification({
      userId: post.user_id as string,
      type: "board_comment",
      actorId: user.id,
      actorNickname: nickname,
      title,
      preview,
      link,
    });
  }

  revalidateBoard(postId);
  return { success: true, id: postId };
}

export async function updateBoardComment(input: {
  commentId: string;
  content: string;
}): Promise<BoardResult> {
  const commentId = String(input.commentId ?? "");
  if (!isUuid(commentId)) return { error: "잘못된 접근입니다." };

  const validated = validateBoardCommentContent(input.content);
  if ("error" in validated) return { error: validated.error };

  const viewer = await getBoardViewer();
  if (!viewer.loggedIn) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: comment } = await admin
    .from("board_comments")
    .select("post_id, user_id, is_deleted")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment || comment.is_deleted) return { error: "댓글을 찾을 수 없어요." };

  if (!canEditBoardComment({ user_id: comment.user_id as string }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { error } = await admin
    .from("board_comments")
    .update({ content: validated.content, updated_at: new Date().toISOString() })
    .eq("id", commentId);
  if (error) return { error: "수정에 실패했어요." };

  revalidateBoard(comment.post_id as string);
  return { success: true, id: comment.post_id as string };
}

export async function deleteBoardComment(commentId: string): Promise<BoardResult> {
  if (!isUuid(commentId)) return { error: "잘못된 접근입니다." };

  const viewer = await getBoardViewer();
  if (!viewer.loggedIn) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: comment } = await admin
    .from("board_comments")
    .select("post_id, user_id, parent_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return { error: "댓글을 찾을 수 없어요." };

  if (!canDeleteBoardComment({ user_id: comment.user_id as string }, viewer)) {
    return { error: "권한이 없어요." };
  }

  // 답글이 달린 원 댓글은 행을 지우지 않고 "삭제된 댓글" 표시만 남긴다 — 통째로
  // 지우면 그 아래 답글들이 무슨 말에 대한 답인지 알 수 없게 된다(cascade 로 같이
  // 지워버리면 남의 글까지 지우는 셈이다).
  const { count: replyCount } = await admin
    .from("board_comments")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", commentId);

  const { error } =
    (replyCount ?? 0) > 0
      ? await admin
          .from("board_comments")
          .update({
            is_deleted: true,
            content: "삭제된 댓글입니다.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", commentId)
      : await admin.from("board_comments").delete().eq("id", commentId);

  if (error) return { error: "삭제에 실패했어요." };

  revalidateBoard(comment.post_id as string);
  return { success: true };
}
