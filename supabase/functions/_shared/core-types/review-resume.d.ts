export declare const RESUME_SPREAD_PER_DAY = 10;
export declare const RESUME_SPREAD_MAX_DAYS = 30;
export declare function spreadResumeDueDates(count: number, now?: Date, opts?: {
    perDay?: number;
    maxDays?: number;
}): Date[];
