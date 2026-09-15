export type SrsState = {
    intervalDays: number;
    ease: number;
    reps: number;
    lapses: number;
};
export declare const SRS_INITIAL: SrsState;
export declare const SRS_MIN_EASE = 1.3;
export declare const SRS_MAX_EASE = 2.5;
export declare const SRS_EASE_PENALTY = 0.2;
export declare const SRS_EASE_BONUS = 0.05;
export declare const SRS_MAX_INTERVAL_DAYS = 180;
export declare const SRS_FIRST_INTERVAL_DAYS = 1;
export declare const SRS_SECOND_INTERVAL_DAYS = 3;
export declare const SRS_RELEARN_DELAY_HOURS = 3;
export declare const SRS_LEECH_THRESHOLD = 8;
export declare const SRS_LEECH_REPEAT: number;
export declare const SRS_EARLY_LAPSE_RATIO = 0.5;
export declare const SRS_EARLY_LAPSE_FACTOR = 0.5;
export declare const SRS_FUZZ_MIN_DAYS = 4;
export declare const SRS_FUZZ_RATIO = 0.1;
export declare function isLeechTrigger(lapses: number): boolean;
export declare function srsDayIndex(at: Date): number;
export declare function srsDayStart(dayIndex: number): Date;
export declare function srsDueAt(now: Date, intervalDays: number): Date;
export type SrsResult = {
    state: SrsState;
    dueAt: Date;
    leech?: boolean;
};
export declare function isSameSrsDay(a: Date, b: Date): boolean;
export declare function srsRelearnDueAt(now: Date): Date;
export declare function srsGuessed(prev: SrsState, now: Date): SrsResult;
export declare function fuzzInterval(days: number, rand?: () => number): number;
export type NextSrsOptions = {
    dueAt?: Date | null;
    fuzz?: () => number;
};
export declare function nextSrs(prev: SrsState, isCorrect: boolean, now: Date, lastGradedAt?: Date | null, opts?: NextSrsOptions): SrsResult;
export declare function srsStateFromRow(row: {
    srs_interval_days?: number | null;
    srs_ease?: number | null;
    srs_reps?: number | null;
    srs_lapses?: number | null;
}): SrsState;
