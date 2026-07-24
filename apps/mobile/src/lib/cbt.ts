import { supabase } from "./supabase";

// 채점은 Supabase Edge Functions(cbt-start / cbt-submit)로만 한다. 정답은 클라이언트에
// RLS 로 차단돼 있어 앱이 직접 채점할 수 없다. invoke 는 로그인 사용자의 JWT 를
// Authorization 헤더로 자동 첨부한다.

export const MIN_ATTEMPT_SECONDS = 180;

export type CbtQuestionResult = {
  question_number: number;
  selected_choice: number | null;
  is_correct: boolean;
};

export type CbtSubmitResult = {
  attemptId: string;
  score: number;
  totalQuestions: number;
  durationSeconds: number;
  voidedQuestions: number[];
  questionResults: CbtQuestionResult[];
};

export async function startCbtAttempt(paperId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("cbt-start", {
    body: { paperId },
  });
  if (error) throw await toError(error, "시작 기록에 실패했어요.");
  if (!data?.startedAt) throw new Error(data?.error ?? "시작 기록에 실패했어요.");
  return data.startedAt as string;
}

export async function submitCbtAttempt(
  paperId: string,
  answers: (number | null)[],
): Promise<CbtSubmitResult> {
  const { data, error } = await supabase.functions.invoke("cbt-submit", {
    body: { paperId, answers },
  });
  if (error) throw await toError(error, "채점에 실패했어요.");
  if (!data?.success) throw new Error(data?.error ?? "채점에 실패했어요.");
  return data as CbtSubmitResult;
}

// Edge Function 이 4xx/5xx 로 응답하면 supabase-js 는 FunctionsHttpError 를 주고 본문은
// error.context(Response)에 들어있다. 서버가 담아 보낸 한국어 메시지를 꺼내 쓴다.
async function toError(error: unknown, fallback: string): Promise<Error> {
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json();
      if (body?.error) return new Error(body.error);
    } catch {
      // 본문 파싱 실패 시 fallback
    }
  }
  return new Error(error instanceof Error ? error.message : fallback);
}
