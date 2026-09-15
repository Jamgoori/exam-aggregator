export type StudyPhase = "expanding" | "settling";
export declare const PHASE_WINDOW_DAYS = 7;
export declare const PHASE_ENTER_EXPANDING = 2.5;
export declare const PHASE_ENTER_SETTLING = 1.5;
export declare const PHASE_FIRST_THRESHOLD: number;
export declare function inflowRatio(recentWrongCount: number, dailyLimit: number, windowDays?: number): number;
export type StudyPhaseInput = {
    recentWrongCount: number;
    dailyLimit: number;
    unresolvedTotal: number;
    previous?: StudyPhase | null;
};
export declare function detectStudyPhase(input: StudyPhaseInput): StudyPhase;
export declare function isPhaseTransition(previous: StudyPhase | null | undefined, next: StudyPhase): boolean;
