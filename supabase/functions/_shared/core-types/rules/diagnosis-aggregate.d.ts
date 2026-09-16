import type { SupabaseClient } from "@supabase/supabase-js";
export { DIAGNOSIS_WINDOW_DAYS } from "../data/home.d.ts";
type Admin = SupabaseClient;
export type ConceptStat = {
    concept: string;
    conceptId: string | null;
    conceptKind: string | null;
    subject: string | null;
    subjectSlug: string | null;
    wrongCount: number;
    answeredCount: number;
    accuracyPct: number | null;
    corpusCount: number;
    scoreGainPct: number | null;
};
export type SubjectStat = {
    id: string;
    name: string;
    slug: string;
    attempts: number;
    avgScorePct: number | null;
    recentScores: number[];
};
export type SubjectConceptGroup = {
    subject: string;
    subjectSlug: string | null;
    totalWrong: number;
    concepts: ConceptStat[];
};
export type DiagnosisWindow = {
    days: number | null;
    widened: boolean;
};
export type DiagnosisAggregate = {
    window: DiagnosisWindow;
    totals: {
        attempts: number;
        wrongQuestions: number;
        conceptsWithKeyword: number;
    };
    subjects: SubjectStat[];
    concepts: ConceptStat[];
    bySubject: SubjectConceptGroup[];
};
export type DiagnosisAggregateOptions = {
    days?: number | null;
    widen?: boolean;
    subjectSlug?: string | null;
};
export type DiagnosisAggregateDeps = {
    now?: Date;
};
export declare function getDiagnosisAggregate(admin: Admin, userId: string, opts?: DiagnosisAggregateOptions, deps?: DiagnosisAggregateDeps): Promise<DiagnosisAggregate>;
export type BoardConcept = {
    concept: string;
    conceptId: string | null;
    subject: string | null;
    subjectSlug: string | null;
    wrongCount: number;
    accuracyPct: number | null;
    scoreGainPct: number | null;
    corpusCount: number;
};
export type BoardSubjectGroup = {
    subject: string;
    subjectSlug: string | null;
    totalWrong: number;
    concepts: BoardConcept[];
};
export type DiagnosisBoard = {
    window: DiagnosisWindow;
    subjects: {
        name: string;
        slug: string;
    }[];
    concepts: BoardConcept[];
    bySubject: BoardSubjectGroup[];
};
export declare function toDiagnosisBoard(agg: DiagnosisAggregate): DiagnosisBoard;
export type PendingDiagnosisBatch = {
    requestedAt: string;
    conceptCount: number;
};
export declare function getPendingDiagnosisBatch(admin: Admin, userId: string): Promise<PendingDiagnosisBatch | null>;
