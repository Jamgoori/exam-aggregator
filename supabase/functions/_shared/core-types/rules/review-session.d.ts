import type { SupabaseClient } from "@supabase/supabase-js";
import { type ReviewPickStrategy } from "../review-pick.d.ts";
import { type RecordQuestionResultsOptions } from "./question-status.d.ts";
export declare const REVIEW_SESSION_MAX_LIMIT = 50;
export type ReviewItemView = {
    position: number;
    images: string[];
    choiceCount: number;
    selectedChoice: number | null;
    correctChoice: number | null;
    isCorrect: boolean | null;
    paperId: string | null;
    paperTitle: string | null;
    questionNumber: number | null;
    guessed: boolean;
};
export type ReviewSessionView = {
    id: string;
    scope: string;
    createdAt: string;
    subjectSlug: string | null;
    subjectName: string | null;
    total: number;
    score: number | null;
    submitted: boolean;
    items: ReviewItemView[];
};
export type ReviewItemRef = {
    paperId: string;
    questionNumber: number;
};
export type CreateReviewSessionResult = {
    sessionId?: string;
    error?: string;
};
export type SubjectReviewSource = {
    subject: {
        id: string;
    };
    questions: {
        paperId: string;
        questionNumber: number;
        wrongCount: number;
        lastWrongAt: string;
        resolved: boolean;
        images: string[];
    }[];
} | null;
export type SubjectReviewLoader = (client: SupabaseClient, userId: string, subjectSlug: string) => Promise<SubjectReviewSource>;
export declare function collectSubjectReviewSource(client: SupabaseClient, userId: string, subjectSlug: string): Promise<SubjectReviewSource>;
export type CreateSubjectReviewInput = {
    subjectSlug: string;
    onlyUnresolved: boolean;
    onlyDue?: boolean;
    limit?: number;
    strategy?: ReviewPickStrategy;
    requestId?: string | null;
};
export type CreateReviewSessionDeps = {
    now?: Date;
    random?: () => number;
    loadSubject?: SubjectReviewLoader;
};
export declare function createReviewSessionForUser(client: SupabaseClient, admin: SupabaseClient, userId: string, input: CreateSubjectReviewInput, deps?: CreateReviewSessionDeps): Promise<CreateReviewSessionResult>;
export type AllReviewCandidate = {
    paperId: string;
    questionNumber: number;
    wrongCount: number;
    lastWrongAt: string;
    resolved: boolean;
    images: string[];
};
export declare function collectAllReviewCandidates(client: SupabaseClient, userId: string, opts: {
    onlyDue?: boolean;
    includeResolved?: boolean;
    subjectId?: string | null;
    now?: Date;
}): Promise<AllReviewCandidate[]>;
export declare function collectPaperReviewCandidates(client: SupabaseClient, userId: string, paperIds: string[]): Promise<ReviewItemRef[]>;
export declare function createPaperReviewSessionForUser(client: SupabaseClient, admin: SupabaseClient, userId: string, paperIds: string[], opts?: {
    requestId?: string | null;
    random?: () => number;
}): Promise<CreateReviewSessionResult>;
export type CreateAllReviewInput = {
    onlyDue?: boolean;
    includeResolved?: boolean;
    strategy?: ReviewPickStrategy;
    limit?: number;
    requestId?: string | null;
    now?: Date;
};
export declare function createAllReviewSessionForUser(client: SupabaseClient, admin: SupabaseClient, userId: string, opts: CreateAllReviewInput): Promise<CreateReviewSessionResult>;
export declare function filterQuestionsAnsweredByUser(client: SupabaseClient, items: ReviewItemRef[], userId?: string): Promise<ReviewItemRef[]>;
export type CreateFromItemsOptions = {
    keepOrder?: boolean;
    scope?: string;
    subjectId?: string | null;
    maxLimit?: number;
    requestId?: string | null;
    random?: () => number;
};
export declare function createReviewSessionFromItems(admin: SupabaseClient, userId: string, items: ReviewItemRef[], limit?: number, opts?: CreateFromItemsOptions): Promise<CreateReviewSessionResult>;
export declare function createDueReviewSessionForUser(admin: SupabaseClient, userId: string, items: ReviewItemRef[], opts?: {
    requestId?: string | null;
}): Promise<CreateReviewSessionResult>;
export declare function findUnfinishedDueSession(admin: SupabaseClient, userId: string, now?: Date): Promise<{
    sessionId: string;
    total: number;
} | null>;
export declare function markReviewItemGuessed(admin: SupabaseClient, userId: string, sessionId: string, position: number, now?: Date): Promise<{
    error?: string;
}>;
export declare function collectConceptReviewCandidates(client: SupabaseClient, admin: SupabaseClient, concept: string, subjectSlug: string | null, conceptId?: string | null): Promise<ReviewItemRef[]>;
export declare function createConceptReviewSessionForUser(client: SupabaseClient, admin: SupabaseClient, userId: string, input: {
    concept: string;
    conceptId?: string | null;
    subjectSlug: string | null;
    limit?: number;
    requestId?: string | null;
}, deps?: {
    random?: () => number;
}): Promise<CreateReviewSessionResult>;
export declare function getReviewSessionView(client: SupabaseClient, admin: SupabaseClient, userId: string, sessionId: string): Promise<ReviewSessionView | null>;
export type ReviewSolveItem = {
    position: number;
    images: string[];
    choiceCount: number;
};
export declare function toReviewSolveItems(view: ReviewSessionView): ReviewSolveItem[];
export type ReviewResultItem = {
    position: number;
    images: string[];
    choiceCount: number;
    selectedChoice: number | null;
    correctChoice: number | null;
    isCorrect: boolean;
    paperTitle: string | null;
    questionNumber: number | null;
    guessed: boolean;
    paperId: string | null;
};
export declare function toReviewResultItems(view: ReviewSessionView): ReviewResultItem[];
export type ReviewHistoryEntry = {
    sessionId: string;
    scope: string;
    subjectSlug: string | null;
    subjectName: string | null;
    total: number;
    score: number | null;
    createdAt: string;
    submittedAt: string;
};
export declare function listSubmittedReviewSessions(admin: SupabaseClient, userId: string, opts?: {
    scope?: string | null;
    subjectSlug?: string | null;
    limit?: number;
}): Promise<ReviewHistoryEntry[]>;
export type SubmitReviewSessionOptions = {
    now?: Date;
    questionStatus?: RecordQuestionResultsOptions;
};
export type SubmitReviewSessionResult = {
    error?: string;
    status?: 400 | 404 | 500;
    view?: ReviewSessionView;
};
export declare function submitReviewSessionForUser(client: SupabaseClient, admin: SupabaseClient, userId: string, sessionId: string, answers: (number | null)[], opts?: SubmitReviewSessionOptions): Promise<SubmitReviewSessionResult>;
export declare function fetchLastWrongChoices(admin: SupabaseClient, userId: string, subjectId: string): Promise<Map<string, number | null>>;
