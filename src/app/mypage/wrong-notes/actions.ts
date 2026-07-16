"use server";

import { getSessionUser } from "@/lib/supabase/session";
import {
  createReviewSessionForUser,
  submitReviewSessionForUser,
  type ReviewSessionView,
} from "@/lib/review-session";

export type CreateReviewResult = { error?: string; sessionId?: string };

// 섞어풀기 세션 시작. 성공하면 sessionId를 돌려주고, 호출부(클라이언트)가 풀이
// 페이지로 이동한다.
export async function createReviewSession(input: {
  subjectSlug: string;
  onlyUnresolved?: boolean;
  limit?: number;
}): Promise<CreateReviewResult> {
  const slug = String(input?.subjectSlug ?? "");
  if (!slug) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  return createReviewSessionForUser(supabase, user.id, {
    subjectSlug: slug,
    onlyUnresolved: input.onlyUnresolved ?? true,
    limit: input.limit,
  });
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
