"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type CommentResult = { error?: string; success?: boolean };

const NICKNAME_MAX = 10;
const CONTENT_MAX = 2000;
const PW_MIN = 4;
const PW_MAX = 16;

// UUID 형식 검증 (임의 문자열이 쿼리에 들어가지 않도록 1차 방어)
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function validateContent(content: string): string | null {
  if (!content) return "내용을 입력해주세요.";
  if (content.length > CONTENT_MAX)
    return `내용은 ${CONTENT_MAX}자 이하로 입력해주세요.`;
  return null;
}

function validatePassword(pw: string): string | null {
  if (pw.length < PW_MIN || pw.length > PW_MAX)
    return `비밀번호는 ${PW_MIN}~${PW_MAX}자로 입력해주세요.`;
  return null;
}

export async function postComment(input: {
  paperId: string;
  content: string;
  nickname?: string;
  password?: string;
}): Promise<CommentResult> {
  const paperId = String(input.paperId ?? "");
  const content = String(input.content ?? "").trim();

  if (!isUuid(paperId)) return { error: "잘못된 접근입니다." };

  const contentError = validateContent(content);
  if (contentError) return { error: contentError };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();

  if (user) {
    // 회원: 세션의 닉네임 사용, 비밀번호 불필요
    const nickname =
      (user.user_metadata?.nickname as string | undefined) ??
      user.email?.split("@")[0] ??
      "회원";

    const { error } = await admin.from("comments").insert({
      paper_id: paperId,
      user_id: user.id,
      nickname: nickname.slice(0, NICKNAME_MAX),
      content,
    });
    if (error) return { error: "댓글 등록에 실패했어요." };
  } else {
    // 비회원: 닉네임 + 비밀번호 필요
    const nickname = String(input.nickname ?? "").trim();
    const password = String(input.password ?? "");

    if (!nickname || nickname.length > NICKNAME_MAX)
      return { error: `닉네임은 1~${NICKNAME_MAX}자로 입력해주세요.` };
    const pwError = validatePassword(password);
    if (pwError) return { error: pwError };

    const passwordHash = await bcrypt.hash(password, 10);
    const { error } = await admin.from("comments").insert({
      paper_id: paperId,
      user_id: null,
      nickname,
      content,
      password_hash: passwordHash,
    });
    if (error) return { error: "댓글 등록에 실패했어요." };
  }

  revalidatePath(`/papers/${paperId}`);
  return { success: true };
}

// 댓글 소유권 확인: 회원 댓글이면 세션 user_id 일치(또는 관리자),
// 비회원 댓글이면 비밀번호 일치. 통과 시 admin 클라이언트와 대상 행을 반환.
async function authorizeComment(commentId: string, password?: string) {
  if (!isUuid(commentId)) return { error: "잘못된 접근입니다." as string };

  const admin = createAdminClient();
  const { data: comment } = await admin
    .from("comments")
    .select("id, paper_id, user_id, password_hash")
    .eq("id", commentId)
    .single();

  if (!comment) return { error: "댓글을 찾을 수 없어요." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isAdmin = false;
  if (user) {
    const { data } = await supabase.rpc("is_admin");
    isAdmin = data === true;
  }

  if (!isAdmin) {
    if (comment.user_id) {
      // 회원 댓글: 본인만
      if (user?.id !== comment.user_id) return { error: "권한이 없어요." };
    } else {
      // 비회원 댓글: 비밀번호 확인
      if (!comment.password_hash) return { error: "권한이 없어요." };
      const ok = await bcrypt.compare(
        String(password ?? ""),
        comment.password_hash,
      );
      if (!ok) return { error: "비밀번호가 일치하지 않아요." };
    }
  }

  return { admin, paperId: comment.paper_id as string };
}

export async function updateComment(input: {
  commentId: string;
  content: string;
  password?: string;
}): Promise<CommentResult> {
  const content = String(input.content ?? "").trim();
  const contentError = validateContent(content);
  if (contentError) return { error: contentError };

  const auth = await authorizeComment(input.commentId, input.password);
  if ("error" in auth) return { error: auth.error };

  const { error } = await auth.admin
    .from("comments")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", input.commentId);
  if (error) return { error: "수정에 실패했어요." };

  revalidatePath(`/papers/${auth.paperId}`);
  return { success: true };
}

export async function deleteComment(input: {
  commentId: string;
  password?: string;
}): Promise<CommentResult> {
  const auth = await authorizeComment(input.commentId, input.password);
  if ("error" in auth) return { error: auth.error };

  const { error } = await auth.admin
    .from("comments")
    .delete()
    .eq("id", input.commentId);
  if (error) return { error: "삭제에 실패했어요." };

  revalidatePath(`/papers/${auth.paperId}`);
  return { success: true };
}

export async function postRating(
  paperId: string,
  score: number,
  guestToken: string | null,
): Promise<CommentResult> {
  if (!isUuid(paperId)) return { error: "잘못된 접근입니다." };
  if (!Number.isInteger(score) || score < 1 || score > 5)
    return { error: "잘못된 점수입니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("difficulty_ratings").insert({
    paper_id: paperId,
    user_id: user?.id ?? null,
    guest_token: user ? null : guestToken,
    score,
  });

  if (error) {
    return {
      error: error.code === "23505" ? "이미 평가했어요." : "평가에 실패했어요.",
    };
  }

  revalidatePath(`/papers/${paperId}`);
  return { success: true };
}
