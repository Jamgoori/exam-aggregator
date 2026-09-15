export declare const MIX_LIMIT_OPTIONS: readonly [10, 20, 40, 60];
export declare const MIX_DEFAULT_LIMIT = 20;
export declare const MIX_MIN_LIMIT = 5;
export declare const MIX_MAX_LIMIT = 100;
export declare function clampMixLimit(value: unknown): number;
export type MixCandidate = {
    paperId: string;
    questionNumber: number;
    level?: string | null;
    year?: number | null;
    conceptId?: string | null;
};
export declare const MIX_NO_LEVEL = "__none__";
export declare function filterMixCandidatesByLevel<T extends MixCandidate>(candidates: T[], levels: readonly string[]): T[];
export declare const MIX_RECENT_YEAR_OPTIONS: readonly [3, 5, 10];
export type MixYearRange = {
    from: number | null;
    to: number | null;
};
export declare const MIX_ALL_YEARS: MixYearRange;
export declare function normalizeYearRange(range: Partial<MixYearRange> | null | undefined, bounds: {
    min: number | null;
    max: number | null;
}): MixYearRange;
export declare function recentYearRange(years: number, maxYear: number | null): MixYearRange;
export declare function filterMixCandidatesByYear<T extends MixCandidate>(candidates: T[], range: MixYearRange): T[];
export declare function mixCandidateKey(c: MixCandidate): string;
export declare function pickMixQuestions<T extends MixCandidate>(candidates: T[], limit: number, seenKeys?: ReadonlySet<string>, rand?: () => number): {
    picked: T[];
    unseenCount: number;
    coveredAll: boolean;
};
export declare function mixSessionTitle(createdAt: Date | string, ordinal?: number): string;
export declare function labelMixSessions<T extends {
    id: string;
    createdAt: string;
}>(sessions: T[], dayKey: (iso: string) => string): Map<string, string>;
