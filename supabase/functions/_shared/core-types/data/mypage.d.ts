import type { SupabaseClient } from "@supabase/supabase-js";
import { type WrongAnswerRow, type WrongNoteAttemptRow, type WrongNoteSubjectGroup } from "../wrong-notes.d.ts";
export type UnresolvedBySubject = {
    id: string;
    name: string;
    slug: string;
    unresolved: number;
    due: number;
};
export declare function fetchUnresolvedCountBySubject(client: SupabaseClient, userId: string, now?: Date): Promise<UnresolvedBySubject[]>;
export declare function sumUnresolved(bySubject: readonly UnresolvedBySubject[]): number;
export declare function fetchWrongAnswerRows(client: SupabaseClient, attemptIds: string[]): Promise<WrongAnswerRow[]>;
export declare function fetchQuestionStatusMap(client: SupabaseClient, userId: string, paperIds: string[]): Promise<Map<string, boolean>>;
export declare function fetchWrongNoteGroupsForAttempts(client: SupabaseClient, userId: string, attempts: WrongNoteAttemptRow[]): Promise<WrongNoteSubjectGroup[]>;
export type DiagnosisEligibility = {
    eligible: boolean;
    wrongCount: number;
    attemptCount: number;
};
export declare function fetchDiagnosisEligibility(client: SupabaseClient, userId: string): Promise<DiagnosisEligibility>;
export type WeeklyDiagnosisStatus = "ready" | "pending";
export declare function fetchWeeklyDiagnosisStatus(client: SupabaseClient, userId: string, now?: Date): Promise<WeeklyDiagnosisStatus | null>;
