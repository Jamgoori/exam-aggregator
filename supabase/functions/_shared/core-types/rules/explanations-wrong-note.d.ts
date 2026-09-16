import type { SupabaseClient } from "@supabase/supabase-js";
import type { QuestionExplanationContent } from "./explanations.d.ts";
export declare const WRONG_NOTE_QUESTION_LIMIT = 100;
export type WrongNoteExplanationQuestion = {
    questionNumber: number;
    correctChoice: number | null;
    choiceCount: number;
    images: string[];
    explanation: QuestionExplanationContent;
};
export type WrongNoteExplanations = {
    questions: WrongNoteExplanationQuestion[];
    lockedQuestionNumbers: number[];
    locked: boolean;
    totalCount: number;
};
type AnsweredInput = {
    paperId: string;
    questionNumbers: number[];
};
export declare function fetchAnsweredQuestionNumbers(admin: SupabaseClient, userId: string, input: AnsweredInput): Promise<Set<number>>;
export declare function resolveWrongNoteExplanations(admin: SupabaseClient, input: {
    userId: string;
    paperId: string;
    questionNumbers: number[];
    premium: boolean;
}): Promise<WrongNoteExplanations>;
export {};
