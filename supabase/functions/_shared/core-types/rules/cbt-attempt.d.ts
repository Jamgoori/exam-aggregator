import type { SupabaseClient } from "@supabase/supabase-js";
import { type RecordQuestionResultsOptions } from "./question-status.d.ts";
export { MIN_ATTEMPT_SECONDS, sanitizeSelectedChoice } from "../cbt-attempt.d.ts";
export type CbtQuestionResult = {
    question_number: number;
    selected_choice: number | null;
    is_correct: boolean;
};
export type CbtRuleError = {
    error: string;
    status: 400 | 500;
};
export type CbtStartResult = {
    startedAt: string;
} | CbtRuleError;
export type CbtSubmitSuccess = {
    attemptId: string;
    score: number;
    totalQuestions: number;
    durationSeconds: number;
    voidedQuestions: number[];
    questionResults: CbtQuestionResult[];
    diagnosisProgress?: {
        attemptCount: number;
        wrongCount: number;
    };
};
export type CbtSubmitResult = CbtSubmitSuccess | CbtRuleError;
export declare function isCbtRuleError(r: CbtStartResult | CbtSubmitResult): r is CbtRuleError;
export declare function startCbtAttempt(admin: SupabaseClient, userId: string, paperId: string, now?: Date): Promise<CbtStartResult>;
export type SubmitCbtAttemptOptions = {
    now?: Date;
    questionStatus?: RecordQuestionResultsOptions;
    skipDiagnosisProgress?: boolean;
};
export declare function submitCbtAttempt(admin: SupabaseClient, userId: string, paperId: string, submitted: unknown[], opts?: SubmitCbtAttemptOptions): Promise<CbtSubmitResult>;
