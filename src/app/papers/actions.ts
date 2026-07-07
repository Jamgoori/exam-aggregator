"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import bcrypt from "bcryptjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NICKNAME_MAX, validateNickname } from "@/lib/nickname";

export type CommentResult = { error?: string; success?: boolean };

const CONTENT_MAX = 2000;
const PW_MIN = 4;
const PW_MAX = 16;

// 비회원 댓글 도배 방지 기준
const GUEST_COOLDOWN_MS = 10_000; // 같은 IP에서 연속 작성 시 최소 간격
const GUEST_HOURLY_LIMIT = 20; // 같은 IP에서 1시간 내 허용하는 최대 개수

async function getClientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip");
}

// 비회원 댓글만 대상으로 IP 기반 도배 방지. 계정 없이도 작성 가능한 경로라
// 로그인한 회원 댓글보다 스팸에 취약해서 이 경로에만 적용한다.
async function checkGuestRateLimit(
  admin: ReturnType<typeof createAdminClient>,
  ip: string | null,
): Promise<string | null> {
  if (!ip) return null; // IP를 알 수 없는 환경(로컬 등)에서는 건너뜀

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from("comments")
    .select("created_at")
    .eq("ip_address", ip)
    .is("user_id", null)
    .gte("created_at", oneHourAgo)
    .order("created_at", { ascending: false })
    .limit(GUEST_HOURLY_LIMIT);

  if (!data || data.length === 0) return null;

  const lastCommentAt = new Date(data[0].created_at).getTime();
  if (Date.now() - lastCommentAt < GUEST_COOLDOWN_MS) {
    return "잠시 후 다시 시도해주세요.";
  }
  if (data.length >= GUEST_HOURLY_LIMIT) {
    return "짧은 시간 동안 너무 많은 댓글을 남겼어요. 잠시 후 다시 시도해주세요.";
  }
  return null;
}

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
  parentId?: string;
}): Promise<CommentResult> {
  const paperId = String(input.paperId ?? "");
  const content = String(input.content ?? "").trim();

  if (!isUuid(paperId)) return { error: "잘못된 접근입니다." };

  const contentError = validateContent(content);
  if (contentError) return { error: contentError };

  const admin = createAdminClient();

  // 답글은 같은 문제지의 최상위 댓글에만 달 수 있게 한다 (대댓글의 대댓글 금지).
  // parentId는 클라이언트가 보내는 값이라 여기서 다시 검증해야 의미가 있다.
  let parentId: string | null = null;
  if (input.parentId) {
    if (!isUuid(input.parentId)) return { error: "잘못된 접근입니다." };
    const { data: parent } = await admin
      .from("comments")
      .select("id, paper_id, parent_id")
      .eq("id", input.parentId)
      .maybeSingle();
    if (!parent || parent.paper_id !== paperId || parent.parent_id !== null) {
      return { error: "답글을 달 수 없는 댓글이에요." };
    }
    parentId = parent.id as string;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
      parent_id: parentId,
    });
    if (error) return { error: "댓글 등록에 실패했어요." };
  } else {
    // 비회원: 닉네임 + 비밀번호 필요
    const nicknameResult = validateNickname(String(input.nickname ?? ""));
    if (nicknameResult.error !== null) return { error: nicknameResult.error };
    const nickname = nicknameResult.nickname;
    const password = String(input.password ?? "");

    const pwError = validatePassword(password);
    if (pwError) return { error: pwError };

    const ip = await getClientIp();
    const rateLimitError = await checkGuestRateLimit(admin, ip);
    if (rateLimitError) return { error: rateLimitError };

    const passwordHash = await bcrypt.hash(password, 10);
    const { error } = await admin.from("comments").insert({
      paper_id: paperId,
      user_id: null,
      nickname,
      content,
      password_hash: passwordHash,
      ip_address: ip,
      parent_id: parentId,
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

const VALID_SCORES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export type RatingResult = CommentResult & {
  averageScore?: number | null;
  voteCount?: number;
};

export async function postRating(
  paperId: string,
  score: number,
): Promise<RatingResult> {
  if (!isUuid(paperId)) return { error: "잘못된 접근입니다." };
  if (!VALID_SCORES.includes(score)) return { error: "잘못된 점수입니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { error } = await supabase.from("difficulty_ratings").insert({
    paper_id: paperId,
    user_id: user.id,
    guest_token: null,
    score,
  });

  if (error) {
    return {
      error: error.code === "23505" ? "이미 평가했어요." : "평가에 실패했어요.",
    };
  }

  // 투표 직후 화면에 바로 최신 평균/참여자 수를 보여주기 위해 다시 집계해서 함께 반환한다.
  const { data: ratings } = await supabase
    .from("difficulty_ratings")
    .select("score")
    .eq("paper_id", paperId);
  const scores = (ratings ?? []).map((r) => r.score as number);
  const averageScore =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  revalidatePath(`/papers/${paperId}`);
  return { success: true, averageScore, voteCount: scores.length };
}

export type CbtQuestionResult = {
  question_number: number;
  selected_choice: number | null;
  is_correct: boolean;
};

export type CbtSubmitResult = CommentResult & {
  attemptId?: string;
  score?: number;
  totalQuestions?: number;
  durationSeconds?: number;
  voidedQuestions?: number[];
  questionResults?: CbtQuestionResult[];
};

export async function submitCbtAttempt(input: {
  paperId: string;
  answers: (number | null)[];
  durationSeconds: number;
}): Promise<CbtSubmitResult> {
  const paperId = String(input.paperId ?? "");
  if (!isUuid(paperId)) return { error: "잘못된 접근입니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  // 정답은 anon/authenticated에 전혀 노출하지 않으므로 service role로만 조회한다.
  const admin = createAdminClient();
  const { data: paperAnswers } = await admin
    .from("paper_answers")
    .select("answers, voided_questions")
    .eq("paper_id", paperId)
    .maybeSingle();

  if (!paperAnswers) return { error: "이 문제지는 CBT를 지원하지 않아요." };

  const correctAnswers = (paperAnswers.answers ?? []) as number[];
  const voided = new Set((paperAnswers.voided_questions ?? []) as number[]);
  const totalQuestions = correctAnswers.length;
  if (totalQuestions === 0) return { error: "이 문제지는 CBT를 지원하지 않아요." };

  const submitted = Array.isArray(input.answers) ? input.answers : [];
  const durationSeconds = Math.max(0, Math.round(Number(input.durationSeconds) || 0));

  // 회독 배지가 "제출 횟수"만 세다 보니, 한 문제도 안 고르고 연타로 제출해 회독수만
  // 올리는 게 가능했다. 두 가지로 막는다: (1) 아예 아무것도 안 고른 제출은 거부,
  // (2) 같은 문제지를 너무 빨리 다시 채점하는 것도 문항 수에 비례한 최소 간격으로
  // 막는다 — durationSeconds는 클라이언트가 보내는 값이라 조작될 수 있으므로, 서버가
  // 직접 기록한 cbt_attempts.created_at(직전 제출 시각)을 기준으로 판단한다.
  const answeredCount = submitted.filter((a) => typeof a === "number").length;
  if (answeredCount === 0) {
    return { error: "적어도 한 문제는 답을 골라야 채점할 수 있어요." };
  }

  const MIN_COOLDOWN_SECONDS = 15;
  const SECONDS_PER_QUESTION = 2;
  const cooldownSeconds = Math.max(
    MIN_COOLDOWN_SECONDS,
    totalQuestions * SECONDS_PER_QUESTION,
  );
  const { data: lastAttempt } = await supabase
    .from("cbt_attempts")
    .select("created_at")
    .eq("user_id", user.id)
    .eq("paper_id", paperId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastAttempt) {
    const elapsedSeconds =
      (Date.now() - new Date(lastAttempt.created_at).getTime()) / 1000;
    if (elapsedSeconds < cooldownSeconds) {
      const waitSeconds = Math.ceil(cooldownSeconds - elapsedSeconds);
      return {
        error: `너무 빨리 다시 채점하려고 해요. ${waitSeconds}초 후에 다시 시도해주세요.`,
      };
    }
  }

  let score = 0;
  const questionResults: CbtQuestionResult[] = [];
  for (let i = 0; i < totalQuestions; i++) {
    const questionNumber = i + 1;
    const selected =
      typeof submitted[i] === "number" ? (submitted[i] as number) : null;
    const isCorrect = voided.has(questionNumber) || selected === correctAnswers[i];
    if (isCorrect) score++;
    questionResults.push({
      question_number: questionNumber,
      selected_choice: selected,
      is_correct: isCorrect,
    });
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("cbt_attempts")
    .insert({
      user_id: user.id,
      paper_id: paperId,
      score,
      total_questions: totalQuestions,
      duration_seconds: durationSeconds,
    })
    .select("id")
    .single();

  if (attemptError || !attempt) return { error: "채점에 실패했어요." };

  const { error: answersError } = await supabase.from("cbt_attempt_answers").insert(
    questionResults.map((q) => ({ attempt_id: attempt.id, ...q })),
  );

  if (answersError) {
    await supabase.from("cbt_attempts").delete().eq("id", attempt.id);
    return { error: "채점에 실패했어요." };
  }

  return {
    success: true,
    attemptId: attempt.id as string,
    score,
    totalQuestions,
    durationSeconds,
    voidedQuestions: [...voided],
    questionResults,
  };
}

export type BookmarkResult = CommentResult & { bookmarked?: boolean };

export async function toggleBookmark(paperId: string): Promise<BookmarkResult> {
  if (!isUuid(paperId)) return { error: "잘못된 접근입니다." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "로그인이 필요해요." };

  const { data: existing } = await supabase
    .from("bookmarks")
    .select("id")
    .eq("user_id", user.id)
    .eq("paper_id", paperId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("bookmarks")
      .delete()
      .eq("id", existing.id);
    if (error) return { error: "즐겨찾기 해제에 실패했어요." };

    revalidatePath(`/papers/${paperId}`);
    revalidatePath("/mypage");
    return { success: true, bookmarked: false };
  }

  const { error } = await supabase
    .from("bookmarks")
    .insert({ user_id: user.id, paper_id: paperId });
  if (error) return { error: "즐겨찾기에 실패했어요." };

  revalidatePath(`/papers/${paperId}`);
  revalidatePath("/mypage");
  return { success: true, bookmarked: true };
}
