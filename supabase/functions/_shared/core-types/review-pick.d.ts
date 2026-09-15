export declare const REVIEW_PICK_RECENT_DAYS = 30;
export declare const REVIEW_PICK_TIER_WEIGHTS: readonly [3, 2, 1];
export declare const REVIEW_PICK_REPEAT_THRESHOLD = 2;
export type ReviewPickCandidate = {
    wrongCount: number;
    lastWrongAt: string;
};
export type ReviewPickStrategy = "weighted" | "random";
export declare function reviewPickTier(c: ReviewPickCandidate, now?: Date): 0 | 1 | 2;
export declare function pickWeightedReviewCandidates<T extends ReviewPickCandidate>(candidates: T[], limit: number, opts?: {
    now?: Date;
    rand?: () => number;
}): T[];
export declare function pickRandomReviewCandidates<T>(candidates: T[], limit: number, rand?: () => number): T[];
export declare function pickReviewCandidates<T extends ReviewPickCandidate>(candidates: T[], limit: number, strategy: ReviewPickStrategy, opts?: {
    now?: Date;
    rand?: () => number;
}): T[];
