"use server";

import { getSessionUser } from "@/lib/supabase/session";
import {
  createReviewSessionForUser,
  createReviewSessionFromItems,
  createAllReviewSessionForUser,
  createPaperReviewSessionForUser,
  submitReviewSessionForUser,
  type ReviewSessionView,
} from "@/lib/review-session";

export type CreateReviewResult = { error?: string; sessionId?: string };

// 섞어풀기 세션 시작. 성공하면 sessionId를 돌려주고, 호출부(클라이언트)가 풀이
// 페이지로 이동한다.
export async function createReviewSession(input: {
  subjectSlug: string;
  onlyUnresolved?: boolean;
  onlyDue?: boolean;
  limit?: number;
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
}): Promise<CreateReviewResult> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };
  return createAllReviewSessionForUser(supabase, user.id, {
    onlyDue: input?.onlyDue ?? false,
    includeResolved: input?.includeResolved ?? false,
  });
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
