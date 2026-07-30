"use server";

import { getSessionUser } from "@/lib/supabase/session";
import {
  createReviewSessionForUser,
  createReviewSessionFromItems,
  createConceptReviewSessionForUser,
  createAllReviewSessionForUser,
  createDueReviewSessionForUser,
  createPaperReviewSessionForUser,
  markReviewItemGuessed,
  submitReviewSessionForUser,
  type ReviewSessionView,
} from "@/lib/review-session";
import {
  collectDueQueueItems,
  getDueReviewSummary,
  getSessionSchedule,
} from "@/lib/review-queue";
import {
  setSubjectPaused,
  setDailyLimit,
  spreadOverdueBacklog,
  type SetDailyLimitResult,
  type SpreadBacklogResult,
} from "@/lib/review-preferences";
import { isPremium } from "@/lib/membership";
import type { SessionSchedule, ReviewPickStrategy } from "@gongmoa/core";

export type CreateReviewResult = { error?: string; sessionId?: string };

// 클라이언트가 보내는 값이라 문자열을 그대로 믿지 않는다. 모르는 값은 기본값
// ("약한 문제 우선")으로 떨어뜨린다.
function pickStrategy(value: unknown): ReviewPickStrategy {
  return value === "random" ? "random" : "weighted";
}

// 섞어풀기 세션 시작. 성공하면 sessionId를 돌려주고, 호출부(클라이언트)가 풀이
// 페이지로 이동한다.
export async function createReviewSession(input: {
  subjectSlug: string;
  onlyUnresolved?: boolean;
  onlyDue?: boolean;
  limit?: number;
  strategy?: ReviewPickStrategy;
}): Promise<CreateReviewResult> {
  const slug = String(input?.subjectSlug ?? "");
  if (!slug) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  return createReviewSessionForUser(supabase, user.id, {
    subjectSlug: slug,
    onlyUnresolved: input.onlyUnresolved ?? true,
    onlyDue: input.onlyDue ?? false,
    limit: input.limit,
    strategy: pickStrategy(input.strategy),
  });
}

// 진단의 "같은개념 기출 5문제 풀기". 유저 오답이 아니라 기출 전체에서 같은 개념
// (keyword_title) 문항을 랜덤으로 뽑아 세션을 만든다(있는 만큼).
export async function createReviewFromConcept(input: {
  concept: string;
  subjectSlug?: string | null;
  limit?: number;
}): Promise<CreateReviewResult> {
  const concept = String(input?.concept ?? "").trim();
  if (!concept) return { error: "개념을 찾을 수 없어요." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  return createConceptReviewSessionForUser(supabase, user.id, {
    concept,
    subjectSlug: input.subjectSlug ?? null,
    limit: input.limit ?? 5,
  });
}

export type SaveMemoResult = { error?: string; memo?: string };

// 문항 메모 저장/삭제. 빈 문자열이면 삭제한다. paper_id는 오답노트에 실제로 뜬(대표)
// 문제지 id를 그대로 쓴다.
export async function saveQuestionMemo(input: {
  paperId: string;
  questionNumber: number;
  memo: string;
}): Promise<SaveMemoResult> {
  const paperId = String(input?.paperId ?? "");
  const questionNumber = Number(input?.questionNumber);
  if (!paperId || !Number.isInteger(questionNumber)) {
    return { error: "잘못된 접근입니다." };
  }

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const memo = String(input.memo ?? "").trim().slice(0, 2000);

  if (!memo) {
    await supabase
      .from("question_memos")
      .delete()
      .eq("user_id", user.id)
      .eq("paper_id", paperId)
      .eq("question_number", questionNumber);
    return { memo: "" };
  }

  const { error } = await supabase.from("question_memos").upsert(
    {
      user_id: user.id,
      paper_id: paperId,
      question_number: questionNumber,
      memo,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) return { error: "메모 저장에 실패했어요." };
  return { memo };
}

export type MarkResult = { error?: string };

// "다시 볼 문제" 체크 토글. paper_id는 오답노트에 뜬(대표) 문제지 id를 그대로 쓴다.
export async function setQuestionPinned(input: {
  paperId: string;
  questionNumber: number;
  pinned: boolean;
}): Promise<MarkResult> {
  const paperId = String(input?.paperId ?? "");
  const questionNumber = Number(input?.questionNumber);
  if (!paperId || !Number.isInteger(questionNumber)) {
    return { error: "잘못된 접근입니다." };
  }
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { error } = await supabase.from("wrong_note_marks").upsert(
    {
      user_id: user.id,
      paper_id: paperId,
      question_number: questionNumber,
      pinned: Boolean(input.pinned),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) return { error: "저장에 실패했어요." };
  return {};
}

// 오답노트에서 문항 완전 삭제(실수로 틀렸거나 지엽 문항). 응시 원본은 남기고
// 오답노트 조회·집계·섞어풀기 후보에서만 제외한다.
export async function deleteWrongNoteQuestion(input: {
  paperId: string;
  questionNumber: number;
}): Promise<MarkResult> {
  const paperId = String(input?.paperId ?? "");
  const questionNumber = Number(input?.questionNumber);
  if (!paperId || !Number.isInteger(questionNumber)) {
    return { error: "잘못된 접근입니다." };
  }
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { error } = await supabase.from("wrong_note_marks").upsert(
    {
      user_id: user.id,
      paper_id: paperId,
      question_number: questionNumber,
      deleted: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) return { error: "삭제에 실패했어요." };
  return {};
}

// 완전 삭제 직후 "되돌리기". 삭제 마크만 해제한다(응시 원본은 애초에 안 지웠다).
export async function restoreWrongNoteQuestion(input: {
  paperId: string;
  questionNumber: number;
}): Promise<MarkResult> {
  const paperId = String(input?.paperId ?? "");
  const questionNumber = Number(input?.questionNumber);
  if (!paperId || !Number.isInteger(questionNumber)) {
    return { error: "잘못된 접근입니다." };
  }
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const { error } = await supabase.from("wrong_note_marks").upsert(
    {
      user_id: user.id,
      paper_id: paperId,
      question_number: questionNumber,
      deleted: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) return { error: "되돌리지 못했어요." };
  return {};
}

// 시험지별 틀린문제 다시풀기(1개) / 여러 시험지 합쳐 풀기(다중).
export async function createReviewFromPapers(input: {
  paperIds: string[];
}): Promise<CreateReviewResult> {
  const paperIds = Array.isArray(input?.paperIds)
    ? input.paperIds.filter((id) => typeof id === "string" && id)
    : [];
  if (paperIds.length === 0) return { error: "시험지를 선택해주세요." };
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  return createPaperReviewSessionForUser(supabase, user.id, paperIds);
}

// 전 과목 섞어풀기/복습(과목 무관). onlyDue=복습, includeResolved=극복 포함.
export async function createReviewAll(input: {
  onlyDue?: boolean;
  includeResolved?: boolean;
  strategy?: ReviewPickStrategy;
}): Promise<CreateReviewResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  return createAllReviewSessionForUser(supabase, user.id, {
    onlyDue: input?.onlyDue ?? false,
    includeResolved: input?.includeResolved ?? false,
    strategy: pickStrategy(input?.strategy),
  });
}

// 오늘의 복습 세션 시작(유료 전용). 문항 선정·순서는 서버가 정한다 — 클라이언트가
// 문항 목록을 넘기게 하면 상한과 스케줄을 우회할 수 있다.
//
// 멤버십 확인을 여기서 한 번 더 하는 이유: 화면에서 버튼을 숨기는 건 표시일 뿐이고,
// 서버 액션은 URL만 알면 직접 부를 수 있다.
export async function createDueReviewSession(): Promise<CreateReviewResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  if (!(await isPremium(supabase, user.id))) {
    return { error: "복습은 멤버십 기능이에요." };
  }

  const items = await collectDueQueueItems(supabase, user.id);
  return createDueReviewSessionForUser(supabase, user.id, items);
}

// "찍었어요"(유료 전용) — 맞힌 문항의 복습 스케줄만 되돌린다. 점수와 극복 판정은
// 그대로다. 무료 사용자는 스케줄 자체가 없어 할 일이 없다.
export async function markReviewGuessed(input: {
  sessionId: string;
  position: number;
}): Promise<{ error?: string }> {
  const sessionId = String(input?.sessionId ?? "");
  const position = Number(input?.position);
  if (!sessionId || !Number.isInteger(position) || position < 0) {
    return { error: "잘못된 접근입니다." };
  }

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!(await isPremium(supabase, user.id))) return {};

  return markReviewItemGuessed(supabase, user.id, sessionId, position);
}

export type ToggleReviewSubjectResult = { error?: string; pausedSubjectIds?: string[] };

// 복습 과목 보류/재개(유료 전용). 재개 쪽은 밀린 문항의 srs_due_at 을 며칠에 걸쳐
// 다시 뿌리는 쓰기가 붙으므로, 화면에서 패널을 숨기는 것과 별개로 여기서도 막는다.
export async function toggleReviewSubjectPaused(input: {
  subjectId: string;
  paused: boolean;
}): Promise<ToggleReviewSubjectResult> {
  const subjectId = String(input?.subjectId ?? "");
  if (!subjectId) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!(await isPremium(supabase, user.id))) {
    return { error: "복습은 멤버십 기능이에요." };
  }

  return setSubjectPaused(supabase, user.id, subjectId, input.paused === true);
}

// 하루 문항 수 변경(유료 전용). 값 검증은 setDailyLimit이 한다.
export async function setReviewDailyLimit(input: {
  limit: number;
}): Promise<SetDailyLimitResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!(await isPremium(supabase, user.id))) {
    return { error: "복습은 멤버십 기능이에요." };
  }
  return setDailyLimit(supabase, user.id, Number(input?.limit));
}

// "밀린 복습 정리하기"(유료 전용). 연체된 문항의 srs_due_at 을 며칠에 걸쳐 다시
// 뿌리는 쓰기라, 화면에서 버튼을 숨기는 것과 별개로 여기서도 막는다.
export async function spreadReviewBacklog(): Promise<SpreadBacklogResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  if (!(await isPremium(supabase, user.id))) {
    return { error: "복습은 멤버십 기능이에요." };
  }
  return spreadOverdueBacklog(supabase, user.id);
}

// 홈 복습 유도 모달이 마운트된 뒤 부르는 조회. 홈 서버 렌더에 복습 요약을 끼워
// 넣지 않는 이유: 요약 계산이 이미지 조회까지 도는 무거운 작업인데, 홈은 모두가
// 매번 여는 화면이고 모달은 하루 한 번만 뜬다. 오늘 이미 봤으면 이 액션 자체가
// 호출되지 않아 비용이 0이 된다.
export type ReviewNudge = {
  todayCount: number;
  subjects: { name: string; count: number }[];
};

export async function getReviewNudge(): Promise<ReviewNudge> {
  const empty: ReviewNudge = { todayCount: 0, subjects: [] };

  const { supabase, user } = await getSessionUser();
  if (!user) return empty;
  if (!(await isPremium(supabase, user.id))) return empty;

  const summary = await getDueReviewSummary(supabase, user.id);
  return {
    todayCount: summary.todayCount,
    subjects: summary.subjects.map((s) => ({ name: s.name, count: s.count })),
  };
}

export type ReviewScheduleResult = { premium: boolean; schedule?: SessionSchedule };

// 채점 결과 화면의 "다음 복습" 섹션. 무료 사용자는 스케줄 자체가 없으므로
// premium=false만 돌려주고 화면에서 섹션을 통째로 숨긴다.
export async function getReviewSchedule(input: {
  sessionId: string;
}): Promise<ReviewScheduleResult> {
  const sessionId = String(input?.sessionId ?? "");
  if (!sessionId) return { premium: false };

  const { supabase, user } = await getSessionUser();
  if (!user) return { premium: false };
  if (!(await isPremium(supabase, user.id))) return { premium: false };

  const schedule = await getSessionSchedule(supabase, user.id, sessionId);
  return { premium: true, schedule: schedule ?? undefined };
}

// 결과 화면 "틀린 N문항만 다시 풀기".
export async function createReviewFromWrong(input: {
  items: { paperId: string; questionNumber: number }[];
}): Promise<CreateReviewResult> {
  const items = Array.isArray(input?.items) ? input.items : [];
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  return createReviewSessionFromItems(supabase, user.id, items);
}

export type SubmitReviewResult = { error?: string; view?: ReviewSessionView };

export async function submitReviewSession(input: {
  sessionId: string;
  answers: (number | null)[];
}): Promise<SubmitReviewResult> {
  const sessionId = String(input?.sessionId ?? "");
  if (!sessionId) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const answers = Array.isArray(input.answers) ? input.answers : [];
  return submitReviewSessionForUser(supabase, user.id, sessionId, answers);
}
