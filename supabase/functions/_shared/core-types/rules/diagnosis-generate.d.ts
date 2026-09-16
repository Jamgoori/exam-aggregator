import type { SupabaseClient } from "@supabase/supabase-js";
import { type AiDiagnosisReport, type DiagnosisConceptCoaching, type DiagnosisConceptSelection } from "../diagnosis-report.d.ts";
import { type CoachInput, type DiagnosisMessageParams } from "../diagnosis-coach.d.ts";
export type CoachingRequest = {
    index: number;
    target: CoachInput;
    params: DiagnosisMessageParams;
};
export type CoachingPlan = {
    report: Omit<AiDiagnosisReport, "conceptCoaching">;
    targets: CoachInput[];
    requests: CoachingRequest[];
};
export type CoachingPlanDeps = {
    model?: string;
};
export declare function planCoaching(admin: SupabaseClient, userId: string, excludedSubjectSlugs?: Set<string>, selectedConcepts?: DiagnosisConceptSelection[] | null, deps?: CoachingPlanDeps): Promise<{
    plan?: CoachingPlan;
    error?: string;
}>;
export declare function saveDiagnosisReport(admin: SupabaseClient, diagnosisId: string, skeleton: Omit<AiDiagnosisReport, "conceptCoaching">, conceptCoaching: DiagnosisConceptCoaching[], model?: string, now?: Date): Promise<{
    error?: string;
}>;
