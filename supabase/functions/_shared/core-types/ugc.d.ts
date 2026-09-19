export declare const REPORT_REASONS: readonly [{
    readonly slug: "spam";
    readonly label: "스팸·광고";
}, {
    readonly slug: "abuse";
    readonly label: "욕설·혐오";
}, {
    readonly slug: "sexual";
    readonly label: "음란물";
}, {
    readonly slug: "privacy";
    readonly label: "개인정보 노출";
}, {
    readonly slug: "other";
    readonly label: "기타";
}];
export type ReportReasonSlug = (typeof REPORT_REASONS)[number]["slug"];
export declare function isReportReason(value: unknown): value is ReportReasonSlug;
export declare function reportReasonLabel(slug: string): string;
export declare const REPORT_DETAIL_MAX = 500;
export declare function validateReportInput(input: {
    reason: string;
    detail?: string | null;
}): {
    error: string;
} | {
    reason: ReportReasonSlug;
    detail: string | null;
};
export declare function filterBlocked<T extends {
    authorId: string;
}>(items: readonly T[], blockedIds: ReadonlySet<string> | readonly string[]): T[];
