"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { recordQuestionResults } from "@/lib/question-status";
import { getClientIp } from "@/lib/client-ip";
import {
  canReplyTo,
  COMMENT_MAX_DEPTH,
  NICKNAME_MAX,
  validateNickname,
} from "@gongmoa/core";
import {
  COMMENT_CONTENT_MAX,
  COMMENT_PW_MIN,
  COMMENT_PW_MAX,
} from "@gongmoa/core";
import { MIN_ATTEMPT_SECONDS, sanitizeSelectedChoice } from "@/lib/cbt-attempt";

export type CommentResult = { error?: string; success?: boolean };

// 비회원 댓글 도배 방지 기준
const GUEST_COOLDOWN_MS = 10_000; // 같은 IP에서 연속 작성 시 최소 간격
const GUEST_HOURLY_LIMIT = 20; // 같은 IP에서 1시간 내 허용하는 최대 개수

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
  if (content.length > COMMENT_CONTENT_MAX)
    return `내용은 ${COMMENT_CONTENT_MAX}자 이하로 입력해주세요.`;
  return null;
}

function validatePassword(pw: string): string | null {
  if (pw.length < COMMENT_PW_MIN || pw.length > COMMENT_PW_MAX)
    return `비밀번호는 ${COMMENT_PW_MIN}~${COMMENT_PW_MAX}자로 입력해주세요.`;
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

  // 답글 깊이 제한(COMMENT_MAX_DEPTH). parentId는 클라이언트가 보내는 값이라 여기서
  // 다시 검증해야 의미가 있다 — 부모를 따라 올라가며 깊이를 세고, 한도에 닿았으면 거절.
  let parentId: string | null = null;
  if (input.parentId) {
    if (!isUuid(input.parentId)) return { error: "잘못된 접근입니다." };
    const { data: parent } = await admin
      .from("comments")
      .select("id, paper_id, parent_id")
      .eq("id", input.parentId)
      .maybeSingle();
    if (!parent || parent.paper_id !== paperId) {
      return { error: "답글을 달 수 없는 댓글이에요." };
    }

    // 부모의 깊이 = 조상 수 + 1. 한도까지만 올라가면 되므로 조회는 최대 MAX-1회.
    let depth = 1;
    let cursor = parent.parent_id as string | null;
    while (cursor) {
      depth++;
      if (depth >= COMMENT_MAX_DEPTH) break;
      const { data: up } = await admin
        .from("comments")
        .select("parent_id")
        .eq("id", cursor)
        .maybeSingle();
      cursor = (up?.parent_id as string | null) ?? null;
    }
    if (!canReplyTo(depth)) {
      return { error: "여기에는 더 답글을 달 수 없어요." };
    }
    parentId = parent.id as string;
  }

  const { user } = await getSessionUser();

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

  const { supabase, user } = await getSessionUser();

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

  const { supabase, user } = await getSessionUser();
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

export type StartCbtAttemptResult = CommentResult & { startedAt?: string };

// 회독 배지가 "제출 횟수"만 세다 보니, 페이지 진입 직후 아무것도 안 풀고 연타로
// 제출해 회독수만 올리는 게 가능했다. 클라이언트가 보내는 durationSeconds는 조작
// 가능해서 신뢰할 수 없으므로, startCbtAttempt가 서버에 직접 기록해 둔 시작 시각과
// 현재 시각의 차이로만 최소 응시시간을 검증한다.
//
// 이 함수가 기록하는 시각을 그대로 응답에 실어 돌려준다 — 클라이언트가 이 응답을
// 기다리지 않고 자기 시계로 먼저 타이머를 시작해버리면, 그 사이의 네트워크 지연
// (드물게는 수십 초까지도)만큼 서버 기준 "3분"이 클라이언트가 보는 화면보다 항상
// 늦게 끝나서 실제로는 3분보다 더 기다려야 제출되는 문제가 생긴다. 클라이언트는
// 반드시 이 응답의 startedAt을 기준시각으로 써야 이 차이가 사라진다.
export async function startCbtAttempt(paperId: string): Promise<StartCbtAttemptResult> {
  const id = String(paperId ?? "");
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  // started_at은 반드시 서버(service_role)만 쓴다. 사용자 세션으로 쓰게 하면
  // authenticated insert/update 정책이 필요해지고, 그 정책이 있으면 클라이언트가
  // REST 호출로 started_at을 과거로 조작해 최소 응시시간 검증을 통째로 우회할 수 있다.
  const admin = createAdminClient();
  const startedAt = new Date().toISOString();
  const { error } = await admin
    .from("cbt_attempt_starts")
    .upsert(
      { user_id: user.id, paper_id: id, started_at: startedAt },
      { onConflict: "user_id,paper_id" },
    );
  if (error) return { error: "시작 기록에 실패했어요." };
  return { success: true, startedAt };
}

export async function submitCbtAttempt(input: {
  paperId: string;
  answers: (number | null)[];
}): Promise<CbtSubmitResult> {
  const paperId = String(input.paperId ?? "");
  if (!isUuid(paperId)) return { error: "잘못된 접근입니다." };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  // 정답은 anon/authenticated에 전혀 노출하지 않으므로 service role로만 조회한다.
  // 응시 기록(cbt_attempts/cbt_attempt_answers/cbt_attempt_starts) 쓰기도 전부
  // service role로만 한다 — 사용자 세션 쓰기를 허용하면 클라이언트가 REST 호출로
  // 점수·시작시각을 위조해 회독 배지와 공개 통계(회차별 평균, 전국 오답률, 총 응시
  // 수)를 오염시킬 수 있다. 본인 확인은 위 세션 검사로 끝났고 user.id만 기록한다.
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

  const { data: startRecord } = await admin
    .from("cbt_attempt_starts")
    .select("started_at")
    .eq("user_id", user.id)
    .eq("paper_id", paperId)
    .maybeSingle();

  if (!startRecord) {
    return { error: "새로고침 후 다시 시작해주세요." };
  }

  const elapsedSeconds =
    (Date.now() - new Date(startRecord.started_at).getTime()) / 1000;
  if (elapsedSeconds < MIN_ATTEMPT_SECONDS) {
    const waitSeconds = Math.ceil(MIN_ATTEMPT_SECONDS - elapsedSeconds);
    return {
      error: `최소 ${MIN_ATTEMPT_SECONDS / 60}분은 풀어야 채점할 수 있어요. ${waitSeconds}초 후에 다시 시도해주세요.`,
    };
  }

  // 저장용 duration도 클라이언트 값 대신 서버가 기록한 시작 시각 기준으로 계산한다.
  const durationSeconds = Math.round(elapsedSeconds);

  let score = 0;
  const questionResults: CbtQuestionResult[] = [];
  for (let i = 0; i < totalQuestions; i++) {
    const questionNumber = i + 1;
    const selected = sanitizeSelectedChoice(submitted[i]);
    const isCorrect = voided.has(questionNumber) || selected === correctAnswers[i];
    if (isCorrect) score++;
    questionResults.push({
      question_number: questionNumber,
      selected_choice: selected,
      is_correct: isCorrect,
    });
  }

  const { data: attempt, error: attemptError } = await admin
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

  const { error: answersError } = await admin.from("cbt_attempt_answers").insert(
    questionResults.map((q) => ({ attempt_id: attempt.id, ...q })),
  );

  if (answersError) {
    // service_role이라 이 롤백이 실제로 지워진다 (사용자 세션에는 delete 정책이
    // 없어서 예전엔 이 줄이 조용히 아무것도 안 지우고 고아 응시 행을 남겼다).
    await admin.from("cbt_attempts").delete().eq("id", attempt.id);
    return { error: "채점에 실패했어요." };
  }

  // 문항 단위 통합 상태 갱신(오답노트 극복 판정·섞어풀기 공유). 부가 집계라 실패해도
  // 채점 결과는 그대로 돌려준다 — 마이그레이션 적용 전이면 테이블이 없어 조용히 무시된다.
  try {
    await recordQuestionResults(user.id, paperId, questionResults, "cbt");
  } catch {
    // 무시: 상태 갱신 실패가 채점을 막지 않는다.
  }

  // 채점에 성공했으니 시작 기록을 지워, 같은 시작 시각으로 다시 제출(replay)해
  // 대기 없이 회독을 늘리는 걸 막는다. 다음 응시는 startCbtAttempt가 새로 기록한다.
  await admin
    .from("cbt_attempt_starts")
    .delete()
    .eq("user_id", user.id)
    .eq("paper_id", paperId);

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

  const { supabase, user } = await getSessionUser();
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
