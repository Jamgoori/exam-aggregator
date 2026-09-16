export type DiagnosisWeakConcept = {
    concept: string;
    subject: string | null;
    subjectSlug: string | null;
    wrongCount: number | null;
    resolvedCount: number | null;
    frequency?: number | null;
    accuracyPct?: number | null;
};
export type DiagnosisSubjectTrend = {
    subject: string;
    trend: "up" | "down" | "flat";
    note: string;
    scores?: number[] | null;
};
export type DiagnosisMission = {
    headline: string;
    subjectSlug?: string | null;
    concept?: string | null;
};
export type DiagnosisInsight = {
    subject?: string | null;
    text: string;
    wrongRatePct?: number | null;
};
export type DiagnosisCoachingEvidence = {
    question: string;
    myChoice?: string | null;
    insight: string;
};
export type DiagnosisCoachingStep = {
    title: string;
    detail: string;
    minutes?: number | null;
};
export type DiagnosisConceptCoaching = {
    concept: string;
    conceptId?: string | null;
    subject?: string | null;
    subjectSlug?: string | null;
    weakPattern: string;
    howToOvercome: string;
    rootCause?: string | null;
    evidence?: DiagnosisCoachingEvidence[] | null;
    steps?: DiagnosisCoachingStep[] | null;
    checkpoints?: string[] | null;
    trap?: string | null;
};
export type DiagnosisConceptSelection = {
    conceptId: string | null;
    concept: string;
};
export type AiDiagnosisReport = {
    summary: string;
    weakConcepts: DiagnosisWeakConcept[];
    subjectTrends: DiagnosisSubjectTrend[];
    mission?: DiagnosisMission | null;
    insights?: DiagnosisInsight[] | null;
    conceptCoaching?: DiagnosisConceptCoaching[] | null;
};
export declare function conceptSelectionKey(c: {
    conceptId: string | null;
    concept: string;
}): string;
export declare function normalizeConceptSelection(input: DiagnosisConceptSelection[] | null | undefined): DiagnosisConceptSelection[];
