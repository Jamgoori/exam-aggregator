import type { DiagnosisConceptCoaching } from "./diagnosis-report.d.ts";
export declare const DIAGNOSIS_MODEL_DEFAULT = "claude-opus-5";
export declare function resolveDiagnosisModel(envValue?: string | null): string;
export type DiagnosisMessageParams = {
    model: string;
    max_tokens: number;
    output_config: {
        effort: "low" | "medium" | "high" | "xhigh" | "max";
        format: {
            type: "json_schema";
            schema: Record<string, unknown>;
        };
    };
    system: string;
    messages: {
        role: "user";
        content: string;
    }[];
};
export type WrongQuestionSample = {
    conceptKey: string;
    concept: string;
    subject: string | null;
    questionText: string | null;
    correctChoice: number | null;
    correctSummary: string | null;
    pickedChoice: number | null;
    pickedReason: string | null;
    wrongTimes: number;
    resolved: boolean;
};
export type CoachInput = {
    concept: string;
    conceptId: string | null;
    conceptKind: string | null;
    subject: string | null;
    subjectSlug: string | null;
    wrongCount: number;
    answeredCount: number;
    accuracyPct: number | null;
};
export declare function buildCoachingParams(targets: CoachInput[], samples: WrongQuestionSample[], model?: string): DiagnosisMessageParams;
export declare function maxTokensFor(conceptCount: number): number;
export declare function parseCoachingItems(responseText: string, targets: {
    concept: string;
    conceptId?: string | null;
    subject: string | null;
    subjectSlug: string | null;
}[]): DiagnosisConceptCoaching[];
