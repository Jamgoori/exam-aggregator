import type { SupabaseClient } from "@supabase/supabase-js";
export type QuestionResultInput = {
    question_number: number;
    is_correct: boolean;
};
export type QuestionResultSource = "cbt" | "review" | "mix";
export type RecordQuestionResultsOptions = {
    now?: Date;
    fuzz?: () => number;
    startTrial?: (admin: SupabaseClient, userId: string) => Promise<unknown>;
};
export declare function recordQuestionResults(admin: SupabaseClient, userId: string, paperId: string, results: QuestionResultInput[], source?: QuestionResultSource, opts?: RecordQuestionResultsOptions): Promise<void>;
