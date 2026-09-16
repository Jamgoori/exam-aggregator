export declare const DIAGNOSIS_MIN_WRONG = 15;
export declare const DIAGNOSIS_MIN_ATTEMPTS = 3;
export type DiagnosisProgressInput = {
    attemptCount: number;
    wrongCount: number;
};
export type DiagnosisProgress = {
    eligible: boolean;
    ratio: number;
    label: string;
    remainingHint: string | null;
};
export declare function computeDiagnosisProgress({ attemptCount, wrongCount, }: DiagnosisProgressInput): DiagnosisProgress;
