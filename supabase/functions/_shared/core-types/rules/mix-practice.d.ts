import type { SupabaseClient } from "@supabase/supabase-js";
import { type MixCandidate, type MixYearRange } from "../mix-practice.d.ts";
import type { Subject } from "../types.d.ts";
import type { QuestionExplanationContent } from "./explanations.d.ts";
import { type CreateReviewSessionResult } from "./review-session.d.ts";
export declare const MIX_SCOPE = "mix";
export declare function embedOne<T>(value: T | T[] | null | undefined): T | null;
export type MixLevelGroup = {
    key: string;
    count: number;
    approx: boolean;
};
export type MixCountCell = {
    level: string;
    year: number | null;
    count: number;
};
export type MixPool = {
    candidates: MixCandidate[];
    paperCount: number;
    examTypeNames: string[];
    levelGroups: MixLevelGroup[];
    cells: MixCountCell[];
    minYear: number | null;
    maxYear: number | null;
    repByPaperId: Record<string, string>;
};
export type MixPoolLoader = (subjectId: string) => Promise<MixPool>;
export declare const EMPTY_MIX_POOL: MixPool;
export declare function buildMixPool(client: SupabaseClient, admin: SupabaseClient, subjectId: string): Promise<MixPool>;
export type MixHubTier = {
    key: string;
    approx: boolean;
    count: number;
};
export type MixHubSubject = {
    slug: string;
    name: string;
    count: number;
    byTier: Record<string, number>;
};
export type MixHubUnit = "question" | "paper";
export type MixHubIndex = {
    tiers: MixHubTier[];
    subjects: MixHubSubject[];
    unit: MixHubUnit;
};
export declare function fetchPlayableQuestionCounts(client: SupabaseClient): Promise<Record<string, number> | null>;
export type MixHubPaper = {
    id: string;
    subject_id: string;
    exam_type_id: string;
    level: string | null;
    track: string | null;
};
export declare function buildMixHubIndex(input: {
    papers: MixHubPaper[];
    examTypes: {
        id: string;
        name: string;
    }[];
    subjects: {
        id: string;
        slug: string;
        name: string;
    }[];
    playable: Record<string, number> | null;
}): MixHubIndex;
export type MixOverview = {
    subject: Subject;
    questionCount: number;
    paperCount: number;
    examTypeNames: string[];
    levelGroups: MixLevelGroup[];
    cells: MixCountCell[];
    minYear: number | null;
    maxYear: number | null;
};
export declare function toMixOverview(subject: Subject, pool: MixPool): MixOverview;
export type CreateMixSessionResult = {
    sessionId?: string;
    error?: string;
    unseenCount?: number;
    coveredAll?: boolean;
};
export type CreateMixSessionInput = {
    subjectSlug: string;
    limit?: number;
    levels?: string[];
    year?: Partial<MixYearRange> | null;
    requestId?: string | null;
};
export declare function createMixSessionForUser(client: SupabaseClient, admin: SupabaseClient, userId: string, input: CreateMixSessionInput, deps: {
    getMixPool: MixPoolLoader;
}): Promise<CreateMixSessionResult>;
export type MixSessionSummary = {
    id: string;
    title: string;
    createdAt: string;
    score: number;
    total: number;
    wrongCount: number;
    resolvedCount: number;
};
export declare function listMixSessions(client: SupabaseClient, admin: SupabaseClient, userId: string, subjectId: string, deps: {
    getMixPool: MixPoolLoader;
}): Promise<MixSessionSummary[]>;
export type MixSessionBrief = {
    id: string;
    title: string;
    createdAt: string;
    score: number;
    total: number;
    subjectSlug: string;
    subjectName: string;
};
export type MixSessionRow = {
    id: string;
    created_at: string;
    score: number | null;
    total_questions: number;
    subjects: {
        slug: string;
        name: string;
    } | {
        slug: string;
        name: string;
    }[] | null;
};
export declare function toMixSessionBriefs(rows: MixSessionRow[], limit: number): MixSessionBrief[];
export declare function listRecentMixSessions(admin: SupabaseClient, userId: string, limit?: number): Promise<MixSessionBrief[]>;
export type MixSessionQuestion = {
    position: number;
    paperId: string;
    paperTitle: string;
    paperLevel: string | null;
    examTypeName: string | null;
    questionNumber: number;
    selectedChoice: number | null;
    correctChoice: number | null;
    isCorrect: boolean;
    choiceCount: number;
    images: string[];
    explanation: QuestionExplanationContent | null;
    explanationLocked: boolean;
    memo: string | null;
    pinned: boolean;
    wrongCount: number;
    resolved: boolean;
};
export type MixSessionWrongNote = {
    session: {
        id: string;
        title: string;
        createdAt: string;
        score: number;
        total: number;
    };
    subject: Subject;
    questions: MixSessionQuestion[];
    wrongCount: number;
    resolvedCount: number;
};
export declare function getMixSessionWrongNote(client: SupabaseClient, admin: SupabaseClient, userId: string, sessionId: string, includeExplanations: boolean, deps: {
    getMixPool: MixPoolLoader;
}): Promise<MixSessionWrongNote | null>;
export declare function createRetryFromMixSession(admin: SupabaseClient, userId: string, sessionId: string, opts?: {
    requestId?: string | null;
    random?: () => number;
}): Promise<CreateReviewSessionResult>;
