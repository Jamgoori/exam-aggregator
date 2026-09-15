export declare const DUE_QUEUE_LIMIT = 20;
export declare const NEW_QUEUE_LIMIT = 10;
export declare const DAILY_LIMIT_OPTIONS: readonly [10, 20, 40, 60];
export declare function normalizeDailyLimit(value: number | null | undefined): number;
export declare function newItemsForLimit(total: number): number;
export declare const DUE_FORECAST_DAYS = 7;
export type DueCandidate = {
    paperId: string;
    questionNumber: number;
    subjectId: string | null;
    dueAt: string;
    lapses: number;
    conceptKey?: string | null;
    isNew?: boolean;
};
export type PendingCandidate = {
    paperId: string;
    questionNumber: number;
    subjectId: string | null;
    wrongCount: number;
    lastAnsweredAt: string;
    conceptKey?: string | null;
};
export declare const OVERDUE_SCORE_CAP_DAYS = 14;
export declare const LAPSE_SCORE_WEIGHT = 3;
export declare function duePriorityScore(c: DueCandidate, now: Date): number;
export declare const SUBJECT_MIN_SLOTS = 2;
export declare function subjectFloorForLimit(total: number): number;
export declare const PAPER_MAX_SHARE = 0.25;
export declare function paperCapForLimit(total: number): number;
export declare const CONCEPT_MAX_SHARE = 0.15;
export declare function conceptCapForLimit(total: number): number;
export declare const NEW_RECENT_RATIO = 0.3;
export declare function recentItemsForNew(newQuota: number): number;
export type DueQueueLimits = {
    total?: number;
    newItems?: number;
};
export declare function buildDueQueue(candidates: DueCandidate[], pending?: PendingCandidate[], now?: Date, limits?: DueQueueLimits): DueCandidate[];
export type DueForecastDay = {
    offset: number;
    count: number;
};
export type DueForecastInput = {
    total?: number;
    newItems?: number;
    pendingCount?: number;
    days?: number;
};
export declare function forecastDueByDay(candidates: DueCandidate[], now?: Date, input?: DueForecastInput): DueForecastDay[];
export type SessionScheduleItem = {
    position: number;
    paperTitle: string | null;
    questionNumber: number;
    dueInDays: number | null;
};
export type SessionSchedule = {
    items: SessionScheduleItem[];
    forecast: DueForecastDay[];
};
export declare function countBySubject(items: DueCandidate[], subjectName: (subjectId: string | null) => string | null): {
    subjectId: string | null;
    name: string;
    count: number;
}[];
