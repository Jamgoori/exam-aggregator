import type { SupabaseClient } from "@supabase/supabase-js";
export type QuestionMediaEntry = {
    choiceCount: number | null;
    images: string[];
    questionId: string;
};
export declare function fetchQuestionMedia(client: SupabaseClient, paperIds: string[], wanted?: Map<string, Set<number>>): Promise<Map<string, Map<number, QuestionMediaEntry>>>;
