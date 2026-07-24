import { supabase } from "./supabase";

// 섞어풀기 Edge Function 래퍼. 세션 생성·채점은 서버 전용(정답 비공개·회독 위조 방지).

export type ReviewItem = {
  position: number;
  images: string[];
  choiceCount: number;
};

export type ReviewSession = {
  sessionId: string;
  total: number;
  items: ReviewItem[];
};

export type ReviewResultItem = {
  position: number;
  images: string[];
  choiceCount: number;
  selectedChoice: number | null;
  correctChoice: number | null;
  isCorrect: boolean;
  paperTitle: string | null;
  questionNumber: number | null;
};

export type ReviewResult = {
  score: number;
  total: number;
  items: ReviewResultItem[];
};

export async function createReview(onlyUnresolved = true): Promise<ReviewSession> {
  const { data, error } = await supabase.functions.invoke("review-create", {
    body: { onlyUnresolved },
  });
  if (error) throw await unwrap(error, "세션 생성에 실패했어요.");
  if (!data?.sessionId) throw new Error(data?.error ?? "세션 생성에 실패했어요.");
  return data as ReviewSession;
}

export async function submitReview(
  sessionId: string,
  answers: (number | null)[],
): Promise<ReviewResult> {
  const { data, error } = await supabase.functions.invoke("review-submit", {
    body: { sessionId, answers },
  });
  if (error) throw await unwrap(error, "채점에 실패했어요.");
  if (typeof data?.score !== "number") throw new Error(data?.error ?? "채점에 실패했어요.");
  return data as ReviewResult;
}

async function unwrap(error: unknown, fallback: string): Promise<Error> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.error) return new Error(body.error);
    } catch {
      // ignore
    }
  }
  return new Error(error instanceof Error ? error.message : fallback);
}
