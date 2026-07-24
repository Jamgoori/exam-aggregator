import { supabase } from "./supabase";

// AI 약점 진단 래퍼. 생성은 Edge Function(ai-diagnose)이 Claude 를 호출해 한다.

export type DiagnosisWeakConcept = {
  concept: string;
  subject: string | null;
  subjectSlug: string | null;
  wrongCount: number | null;
  resolvedCount: number | null;
};

export type DiagnosisSubjectTrend = {
  subject: string;
  trend: "up" | "down" | "flat";
  note: string;
};

export type AiDiagnosisReport = {
  summary: string;
  weakConcepts: DiagnosisWeakConcept[];
  subjectTrends: DiagnosisSubjectTrend[];
};

export type DiagnosisResult = {
  report: AiDiagnosisReport;
  date: string;
  cached: boolean;
};

export async function requestDiagnosis(): Promise<DiagnosisResult> {
  const { data, error } = await supabase.functions.invoke("ai-diagnose", {
    body: {},
  });
  if (error) throw await unwrap(error, "진단에 실패했어요.");
  if (!data?.report) throw new Error(data?.error ?? "진단에 실패했어요.");
  return data as DiagnosisResult;
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
