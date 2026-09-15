import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudyPhase } from "../study-phase.d.ts";
export type ReviewPrefs = {
    pausedSubjectIds: Set<string>;
    dailyLimit: number;
};
export declare function getReviewPrefs(client: SupabaseClient, userId: string): Promise<ReviewPrefs>;
export declare function getDiagnosisPausedSubjectIds(client: SupabaseClient, userId: string): Promise<Set<string>>;
export declare function getExcludedDiagnosisSubjectSlugs(client: SupabaseClient, userId: string): Promise<Set<string>>;
export type SetDiagnosisSubjectResult = {
    error?: string;
    pausedSubjectIds?: string[];
};
export declare function setDiagnosisSubjectPaused(client: SupabaseClient, userId: string, subjectId: string, paused: boolean, now?: Date): Promise<SetDiagnosisSubjectResult>;
export declare function getStoredStudyPhase(client: SupabaseClient, userId: string): Promise<StudyPhase | null>;
export declare function saveStudyPhase(client: SupabaseClient, userId: string, phase: StudyPhase, now?: Date): Promise<void>;
export declare function getPausedSubjectIds(client: SupabaseClient, userId: string): Promise<Set<string>>;
export type SetDailyLimitResult = {
    error?: string;
    dailyLimit?: number;
};
export declare function setDailyLimit(client: SupabaseClient, userId: string, limit: number, now?: Date): Promise<SetDailyLimitResult>;
export type ReviewSubjectOption = {
    id: string;
    name: string;
    paused: boolean;
    scheduledCount: number;
    pendingCount: number;
};
export declare function getReviewSubjectOptions(client: SupabaseClient, userId: string): Promise<ReviewSubjectOption[]>;
export type SpreadBacklogResult = {
    error?: string;
    spreadCount?: number;
};
export declare function spreadOverdueBacklog(client: SupabaseClient, admin: SupabaseClient, userId: string, now?: Date): Promise<SpreadBacklogResult>;
export type RestoreSuspendedResult = {
    error?: string;
    restoredCount?: number;
};
export declare function restoreSuspendedQuestions(client: SupabaseClient, admin: SupabaseClient, userId: string, now?: Date): Promise<RestoreSuspendedResult>;
export type SetPausedResult = {
    error?: string;
    pausedSubjectIds?: string[];
};
export declare function setSubjectPaused(client: SupabaseClient, admin: SupabaseClient, userId: string, subjectId: string, paused: boolean, now?: Date): Promise<SetPausedResult>;
