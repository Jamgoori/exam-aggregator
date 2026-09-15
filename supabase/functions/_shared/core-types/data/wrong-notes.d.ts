import type { SupabaseClient } from "@supabase/supabase-js";
import type { WrongNoteMarks } from "../wrong-notes.d.ts";
import { type QuestionExplanationContent } from "../rules/explanations.d.ts";
export declare const REVIEW_COOLDOWN_HOURS = 24;
export declare function fetchWrongNoteMarks(client: SupabaseClient, userId: string, paperIds?: string[]): Promise<WrongNoteMarks>;
export declare function fetchCorrectAnswers(admin: SupabaseClient, paperIds: string[]): Promise<Map<string, number[]>>;
export declare function fetchMemos(client: SupabaseClient, userId: string, paperIds: string[]): Promise<Map<string, string>>;
export declare const QUESTION_ID_CHUNK = 200;
type QuestionKey = {
    paperId: string;
    questionNumber: number;
};
export declare function fetchQuestionKeys(admin: SupabaseClient, paperIds: string[], wanted?: Map<string, Set<number>>): Promise<Map<string, QuestionKey>>;
export declare function fetchExplanations(admin: SupabaseClient, paperIds: string[], wanted?: Map<string, Set<number>>, required?: boolean): Promise<Map<string, Map<number, QuestionExplanationContent>>>;
export declare function fetchExplainedNumbers(admin: SupabaseClient, paperIds: string[], wanted?: Map<string, Set<number>>): Promise<Map<string, Set<number>>>;
export {};
