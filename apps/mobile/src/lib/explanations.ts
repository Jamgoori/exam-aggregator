import { supabase } from "./supabase";

// 해설 Edge Function 래퍼. 정답·해설은 admin 전용 RLS 라 서버 경유 필수(CBT와 동일 이유).
export type NormalizedChoice = {
  choice: number;
  text: string;
  currentStatus: string | null;
  originalNote: string | null;
};

export type QuestionExplanationContent = {
  keywordTitle: string | null;
  keywordExplanation: string | null;
  choiceExplanations: NormalizedChoice[];
  correctChoiceSummary: string | null;
  lawAmendmentNote: string | null;
  currentAnswerStatus: string | null;
  currentAnswerNote: string | null;
  lawBasisDate: string | null;
};

export type ExplanationQuestion = {
  questionNumber: number;
  correctChoice: number | null;
  choiceCount: number;
  images: string[];
  explanation: QuestionExplanationContent;
};

export type ExplanationsResult = {
  questions: ExplanationQuestion[];
  totalCount: number;
  hiddenCount: number;
  hasFullAccess: boolean;
  loggedIn: boolean;
};

export async function getPaperExplanations(paperId: string): Promise<ExplanationsResult> {
  const { data, error } = await supabase.functions.invoke("explanations-get", {
    body: { paperId },
  });
  if (error) throw await unwrap(error, "해설을 불러오지 못했어요.");
  if (!data?.questions) throw new Error(data?.error ?? "해설을 불러오지 못했어요.");
  return data as ExplanationsResult;
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
