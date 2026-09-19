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
export declare const REPORT_TARGET_TYPES: readonly [{
    readonly slug: "board_post";
    readonly label: "게시글";
}, {
    readonly slug: "suggestion";
    readonly label: "건의글";
}, {
    readonly slug: "chat_message";
    readonly label: "채팅 메시지";
}];
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number]["slug"];
export declare function isReportTargetType(value: unknown): value is ReportTargetType;
export declare function reportTargetLabel(slug: string): string;
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
    authorId: string | null;
}>(items: readonly T[], blockedIds: ReadonlySet<string> | readonly string[]): T[];
