import type { SupabaseClient } from "@supabase/supabase-js";
import { type AiDiagnosisReport, type DiagnosisConceptSelection } from "../diagnosis-report.d.ts";
export { fetchDiagnosisEligibility, type DiagnosisEligibility } from "../data/mypage.d.ts";
export { nextDiagnosisDate } from "../data/home.d.ts";
export type WeeklyDiagnosis = {
    status: "ready" | "pending";
    report: AiDiagnosisReport | null;
    date: string;
    id: string;
    selectedConcepts: DiagnosisConceptSelection[] | null;
};
export declare function getWeeklyDiagnosis(client: SupabaseClient, userId: string, now?: Date): Promise<WeeklyDiagnosis | null>;
export declare function getLatestReadyDiagnosis(client: SupabaseClient, userId: string): Promise<{
    report: AiDiagnosisReport;
    date: string;
} | null>;
export declare const DIAGNOSIS_LOCKED = "AI \uC57D\uC810 \uC9C4\uB2E8\uC740 \uBA64\uBC84\uC2ED \uAE30\uB2A5\uC774\uC5D0\uC694.";
export type DiagnosisRequestInput = {
    userId: string;
    premium: boolean;
    selectedConcepts?: DiagnosisConceptSelection[] | null;
};
export type DiagnosisRequestDeps = {
    getAdmin: () => SupabaseClient;
    now?: Date;
};
export type DiagnosisRequestResult = {
    ok: false;
    reason: "premium" | "not-eligible" | "insert-failed";
    error: string;
} | {
    ok: true;
    status: "ready" | "pending";
    diagnosisId: string | null;
    date: string;
    nextDate: string;
    selectedConcepts: DiagnosisConceptSelection[];
};
export declare function requestDiagnosisForUser(client: SupabaseClient, input: DiagnosisRequestInput, deps: DiagnosisRequestDeps): Promise<DiagnosisRequestResult>;
