import type { SupabaseClient } from "@supabase/supabase-js";
import { type DueCandidate, type DueForecastDay, type PendingCandidate, type SessionSchedule } from "../review-queue.d.ts";
export type AdminFactory = () => SupabaseClient;
export type DueCandidateSet = {
    candidates: DueCandidate[];
    pending: PendingCandidate[];
    pendingSources: Map<string, string[]>;
    pendingTotal: number;
    suspendedTotal: number;
    subjectNames: Map<string, string>;
    pausedSubjectIds: Set<string>;
    dailyLimit: number;
};
export declare function collectDueCandidates(client: SupabaseClient, userId: string, now: Date | undefined, adminFactory: AdminFactory): Promise<DueCandidateSet>;
export type DueReviewSummary = {
    todayCount: number;
    deferredCount: number;
    newCount: number;
    pendingTotal: number;
    suspendedTotal: number;
    overdueTotal: number;
    relearnCount: number;
    dailyLimit: number;
    subjects: {
        subjectId: string | null;
        name: string;
        count: number;
    }[];
    forecast: DueForecastDay[];
    nextDueOffset: number | null;
};
export declare function getDueReviewSummary(client: SupabaseClient, userId: string, now: Date | undefined, adminFactory: AdminFactory): Promise<DueReviewSummary>;
export declare function getSessionSchedule(client: SupabaseClient, userId: string, sessionId: string, now: Date | undefined, adminFactory: AdminFactory): Promise<SessionSchedule | null>;
export declare function collectDueQueueItems(client: SupabaseClient, userId: string, now: Date | undefined, adminFactory: AdminFactory): Promise<{
    paperId: string;
    questionNumber: number;
}[]>;
export declare function collectExtraQueueItems(client: SupabaseClient, userId: string, now: Date | undefined, adminFactory: AdminFactory): Promise<{
    items: {
        paperId: string;
        questionNumber: number;
    }[];
    error?: string;
}>;
