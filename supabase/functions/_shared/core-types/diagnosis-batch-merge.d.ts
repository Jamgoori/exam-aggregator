import type { DiagnosisConceptCoaching } from "./diagnosis-report.d.ts";
export declare function batchCustomId(diagnosisId: string, index: number): string;
export declare function parseBatchCustomId(customId: string): {
    prefix: string;
    index: number | null;
};
export type ConceptResult = {
    index: number | null;
    status: "succeeded" | "errored" | "canceled" | "expired";
    text: string;
};
export type MergedCoaching = {
    coaching: DiagnosisConceptCoaching[];
    failures: string[];
};
export declare function mergeConceptResults(results: ConceptResult[], targets: {
    concept: string;
    conceptId?: string | null;
    subject: string | null;
    subjectSlug: string | null;
}[]): MergedCoaching;
