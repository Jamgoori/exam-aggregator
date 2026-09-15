"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRateLimiter } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/supabase/session";
import {
  canReplyTo,
  COMMENT_CONTENT_MAX,
  COMMENT_MAX_DEPTH,
  getPaperSlug,
  authorNickname,
  profanityError,
} from "@gongmoa/core";
import {
  isCbtRuleError,
  startCbtAttempt as startCbtAttemptRule,
  submitCbtAttempt as submitCbtAttemptRule,
} from "@gongmoa/core/server";

// 문제지 상세 경로를 다시 만들게 한다.
//
// 주소가 UUID 에서 제목 기반 slug 로 바뀌었으므로 `/papers/<uuid>` 를 무효화하면
// 아무 페이지도 안 지워진다 — 댓글을 달아도 화면에 안 나타나게 된다. 실제 렌더링
// 경로를 만들려면 제목·회차가 필요해서 여기서 한 번 조회한다(인덱스 조회 1회).
async function revalidatePaperPath(paperId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("exam_papers")
    .select("title, round, track")
    .eq("id", paperId)
    .single();
  if (!data) return;
  revalidatePath(`/papers/${getPaperSlug(data.title as string, data.round as number, data.track as string | null)}`);
}

export type CommentResult = { error?: string; success?: boolean };

// UUID 형식 검증 (임의 문자열이 쿼리에 들어가지 않도록 1차 방어)
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

function validateContent(content: string): string | null {
  if (!content) return "내용을 입력해주세요.";
  if (content.length > COMMENT_CONTENT_MAX)
    return `내용은 ${COMMENT_CONTENT_MAX}자 이하로 입력해주세요.`;
  return profanityError(content);
}

export async function postComment(input: {
  paperId: string;
  content: string;
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

  // 회원 전용. 예전에는 닉네임+비밀번호로 비회원도 쓸 수 있었지만, 책임 없는 글이
  // 쌓이는 자리가 되어(도배·비방) 로그인한 사람만 쓰게 바꿨다. 이미 달려 있는 비회원
  // 댓글은 그대로 보이고, 비밀번호로 수정·삭제하는 길도 남겨둔다(authorizeComment).
  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 댓글을 남길 수 있어요." };

  // 이메일 로컬파트로 떨어지지 않는다 — 그 값은 닉네임 정책(금칙어·중복)을 지나간 적이
  // 없어서 "관리자" 같은 이름이 그대로 박힌다(core 의 authorNickname 주석 참고).
  const nickname = authorNickname(user.user_metadata?.nickname);

  const { error } = await admin.from("comments").insert({
    paper_id: paperId,
    user_id: user.id,
    nickname,
    content,
    parent_id: parentId,
  });
  if (error) return { error: "댓글 등록에 실패했어요." };

  await revalidatePaperPath(paperId);
  return { success: true };
}

// 레거시 비회원 댓글의 비밀번호 대입 제한.
//
// 이 경로는 **로그인 없이** 부를 수 있고, 한 번 부를 때마다 서버가 bcrypt 비교를 한 번
// 한다. 상한이 없으면 (1) 짧은 비밀번호가 자동화로 뚫려 남의 댓글이 지워지거나 스팸으로
// 바뀌고, (2) 인증 없이 서버 CPU 를 태우는 증폭 경로가 된다. 비회원 댓글 작성은 이미
// 닫혔지만 수정·삭제 경로는 기존 글을 위해 남아 있어 계속 유효하다.
//
// 정상 사용자는 자기가 정한 비밀번호를 몇 번 안에 맞춘다 — 그래서 웹훅과 달리 빡빡하게
// 잡는다. 댓글 단위로 세므로 여러 댓글을 훑는 것도 각각 막힌다.
// (인스턴스마다 각자 세는 한계는 rate-limit.ts 머리말 참고.)
const GUEST_PASSWORD_ATTEMPTS = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 });

// 댓글 소유권 확인: 회원 댓글이면 세션 user_id 일치(또는 관리자),
// 비회원 댓글이면 비밀번호 일치. 통과 시 admin 클라이언트와 대상 행을 반환.
//
// 실패 문구는 한 가지로 통일한다. "권한이 없어요"와 "비밀번호가 일치하지 않아요"로
// 갈리면, 로그인하지 않은 사람에게 "이 댓글은 비밀번호로 뚫리는 비회원 댓글이다"를
// 알려주는 셈이라 대입 대상을 골라 준다.
const NO_PERMISSION = "권한이 없어요.";

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
      if (user?.id !== comment.user_id) return { error: NO_PERMISSION };
    } else {
      // 비회원 댓글: 비밀번호 확인
      if (!comment.password_hash) return { error: NO_PERMISSION };
      // 대입 제한을 bcrypt **앞에** 둔다 — 뒤에 두면 한도를 넘긴 요청도 해시 비교
      // 비용을 그대로 치른다(막으려던 증폭이 그대로 남는다).
      if (!GUEST_PASSWORD_ATTEMPTS.take(commentId)) {
        return { error: "잠시 후 다시 시도해주세요." };
      }
      const ok = await bcrypt.compare(
        String(password ?? ""),
        comment.password_hash,
      );
      if (!ok) return { error: NO_PERMISSION };
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

  await revalidatePaperPath(auth.paperId);
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

  await revalidatePaperPath(auth.paperId);
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

  await revalidatePaperPath(paperId);
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
  // 결과 모달의 "AI 약점 진단까지 응시 N/3" 진행 바용. 이번 응시까지 포함한 누적
  // 응시 수와 한 번이라도 틀린 문항 수(getDiagnosisEligibility 와 같은 기준).
  // 집계에 실패하면 빠지고, 모달은 그 줄을 그리지 않는다.
  diagnosisProgress?: { attemptCount: number; wrongCount: number };
};

export type StartCbtAttemptResult = CommentResult & { startedAt?: string };

// 회독 배지가 "제출 횟수"만 세다 보니, 페이지 진입 직후 아무것도 안 풀고 연타로
// 제출해 회독수만 올리는 게 가능했다. 클라이언트가 보내는 durationSeconds는 조작
// 가능해서 신뢰할 수 없으므로, startCbtAttempt가 서버에 직접 기록해 둔 시작 시각과
// 현재 시각의 차이로만 최소 응시시간을 검증한다.
//
// 이 함수가 기록하는 시각을 그대로 응답에 실어 돌려준다 — 클라이언트가 이 응답을
// 기다리지 않고 자기 시계로 먼저 타이머를 시작해버리면, 그 사이의 네트워크 지연
// (드물게는 수십 초까지도)만큼 서버 기준 최소 응시시간(MIN_ATTEMPT_SECONDS)이
// 클라이언트가 보는 화면보다 항상 늦게 끝나서 실제로는 그보다 더 기다려야
// 제출되는 문제가 생긴다. 클라이언트는 반드시 이 응답의 startedAt을 기준시각으로
// 써야 이 차이가 사라진다.
export async function startCbtAttempt(paperId: string): Promise<StartCbtAttemptResult> {
  const id = String(paperId ?? "");
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  // started_at은 반드시 서버(service_role)만 쓴다 — 규칙 본문은 core rules/cbt-attempt.ts
  // (Edge cbt-start 와 같은 함수). 본인 확인은 위 세션 검사로 끝났고 user.id만 넘긴다.
  const result = await startCbtAttemptRule(createAdminClient(), user.id, id);
  if (isCbtRuleError(result)) return { error: result.error };
  return { success: true, startedAt: result.startedAt };
}

// 채점의 웹 어댑터. 정답 조회·시작 행 원자 회수·최소 응시시간·채점·응시 기록·문항
// 상태·출석·진단 진행률까지 전부 core rules/cbt-attempt.ts#submitCbtAttempt 가 하고
// (Edge cbt-submit 과 같은 함수), 여기는 세션 검사와 service_role 클라이언트 주입만 한다.
//
// 정답은 anon/authenticated에 전혀 노출하지 않으므로 service role로만 조회한다.
// 응시 기록(cbt_attempts/cbt_attempt_answers/cbt_attempt_starts) 쓰기도 전부
// service role로만 한다 — 사용자 세션 쓰기를 허용하면 클라이언트가 REST 호출로
// 점수·시작시각을 위조해 회독 배지와 공개 통계(회차별 평균, 전국 오답률, 총 응시
// 수)를 오염시킬 수 있다. 본인 확인은 세션 검사로 끝났고 user.id만 기록한다.
export async function submitCbtAttempt(input: {
  paperId: string;
  answers: (number | null)[];
}): Promise<CbtSubmitResult> {
  const paperId = String(input.paperId ?? "");
  if (!isUuid(paperId)) return { error: "잘못된 접근입니다." };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const submitted = Array.isArray(input.answers) ? input.answers : [];
  const result = await submitCbtAttemptRule(createAdminClient(), user.id, paperId, submitted);
  if (isCbtRuleError(result)) return { error: result.error };

  return {
    success: true,
    attemptId: result.attemptId,
    score: result.score,
    totalQuestions: result.totalQuestions,
    durationSeconds: result.durationSeconds,
    voidedQuestions: result.voidedQuestions,
    questionResults: result.questionResults,
    diagnosisProgress: result.diagnosisProgress,
  };
}

const REPORT_REASONS = ["wrong_answer", "wrong_explanation", "image_issue", "other"] as const;
export type QuestionReportReason = (typeof REPORT_REASONS)[number];
export type QuestionReportContext = "explanation" | "cbt";
const REPORT_MESSAGE_MAX = 500;
// 문제지에 실제로 이만큼 많은 문항이 나올 일은 없다 — question_number에 터무니없이
// 큰 값을 넣어 의미 없는 행을 쌓는 것만 걸러내는 느슨한 상한이다.
const REPORT_QUESTION_NUMBER_MAX = 300;
// 같은 계정이 한 시간에 이 개수를 넘겨 신고하면, 문항별 중복 방지(유니크 인덱스)를
// 우회해 서로 다른 문항 번호로 관리자 대기열을 도배할 수 있다. 정상적인 신고는
// 한 세션에 몇 건을 넘기지 않으므로 넉넉히 잡는다.
const REPORT_HOURLY_LIMIT = 20;

export type ReportResult = CommentResult;

// 해설/CBT 화면의 "오류 신고" 버튼이 호출한다. 로그인 사용자만 가능(비회원은 누가
// 신고했는지 특정할 수 없어 도배 방지가 안 됨). 같은 문항을 같은 화면에서 중복
// 신고하면 question_reports_open_unique 유니크 인덱스가 막고, 그 경우도 사용자
// 입장에서는 "접수됐다"와 다르지 않으므로 에러 대신 안내 문구로 돌려준다.
export async function submitQuestionReport(input: {
  paperId: string;
  questionNumber: number;
  context: QuestionReportContext;
  reason: string;
  message?: string;
}): Promise<ReportResult> {
  const paperId = String(input.paperId ?? "");
  if (!isUuid(paperId)) return { error: "잘못된 접근입니다." };

  const questionNumber = Number(input.questionNumber);
  if (
    !Number.isInteger(questionNumber) ||
    questionNumber < 1 ||
    questionNumber > REPORT_QUESTION_NUMBER_MAX
  ) {
    return { error: "잘못된 접근입니다." };
  }

  if (input.context !== "explanation" && input.context !== "cbt") {
    return { error: "잘못된 접근입니다." };
  }

  if (!REPORT_REASONS.includes(input.reason as QuestionReportReason)) {
    return { error: "신고 사유를 선택해주세요." };
  }

  // CBT 응시 중에는 아직 채점 전이라 정답/해설을 보여주지 않으므로, 그 둘을 근거로
  // 하는 사유는 UI에서 애초에 안 보여준다 — 서버에서도 같은 기준으로 거절한다.
  if (
    input.context === "cbt" &&
    (input.reason === "wrong_answer" || input.reason === "wrong_explanation")
  ) {
    return { error: "잘못된 접근입니다." };
  }

  const message = String(input.message ?? "").trim().slice(0, REPORT_MESSAGE_MAX);

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  // 시간당 한도. RLS의 select 정책(auth.uid() = user_id)이 본인 것만 보게 해주므로
  // 이 카운트도 자기 신고만 센다 — 다른 사용자 신고 수를 엿볼 수 있는 경로가 아니다.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabase
    .from("question_reports")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneHourAgo);
  if ((recentCount ?? 0) >= REPORT_HOURLY_LIMIT) {
    return { error: "짧은 시간 동안 신고가 너무 많아요. 잠시 후 다시 시도해주세요." };
  }

  // 쓰기는 service_role 로 한다. question_reports 에는 insert 정책이 없다 — 예전처럼
  // 사용자 세션 클라이언트로 넣으면 바로 위의 시간당 상한과 문항 번호 상한이 화면을
  // 거치지 않는 요청에는 한 번도 평가되지 않는다(schema.sql 참고).
  const { error } = await createAdminClient().from("question_reports").insert({
    user_id: user.id,
    paper_id: paperId,
    question_number: questionNumber,
    context: input.context,
    reason: input.reason,
    message: message || null,
  });

  if (error) {
    return {
      error:
        error.code === "23505"
          ? "이미 신고한 문항이에요. 확인 후 반영할게요."
          : "신고 접수에 실패했어요.",
    };
  }

  return { success: true };
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

    await revalidatePaperPath(paperId);
    revalidatePath("/mypage");
    return { success: true, bookmarked: false };
  }

  const { error } = await supabase
    .from("bookmarks")
    .insert({ user_id: user.id, paper_id: paperId });
  if (error) return { error: "즐겨찾기에 실패했어요." };

  await revalidatePaperPath(paperId);
  revalidatePath("/mypage");
  return { success: true, bookmarked: true };
}
