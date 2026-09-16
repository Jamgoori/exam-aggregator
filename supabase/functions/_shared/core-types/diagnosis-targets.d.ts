import { type DiagnosisConceptSelection } from "./diagnosis-report.d.ts";
export declare const COACH_PER_SUBJECT = 7;
export type CoachTargetConcept = {
    concept: string;
    conceptId: string | null;
    subjectSlug: string | null;
    wrongCount: number;
    accuracyPct: number | null;
};
export declare function pickCoachTargets<T extends CoachTargetConcept>(agg: {
    concepts: T[];
}, excludedSubjectSlugs: Set<string>, selected?: DiagnosisConceptSelection[] | null): T[];
