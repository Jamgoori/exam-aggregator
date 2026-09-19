export declare const BOARD_TITLE_MAX = 100;
export declare const BOARD_CONTENT_HTML_MAX = 30000;
export declare const BOARD_CONTENT_TEXT_MAX = 10000;
export declare const BOARD_COMMENT_MAX = 1000;
export declare const BOARD_CATEGORIES: readonly [{
    readonly slug: "free";
    readonly label: "자유";
    readonly hint: "무슨 이야기든";
}, {
    readonly slug: "question";
    readonly label: "질문";
    readonly hint: "공부하다 막힌 것";
}, {
    readonly slug: "info";
    readonly label: "정보";
    readonly hint: "시험·일정·자료";
}, {
    readonly slug: "review";
    readonly label: "합격수기";
    readonly hint: "직접 겪은 이야기";
}];
export type BoardCategorySlug = (typeof BOARD_CATEGORIES)[number]["slug"];
export declare function isBoardCategory(value: unknown): value is BoardCategorySlug;
export declare function boardCategoryLabel(slug: string): string;
export type BoardViewer = {
    userId: string | null;
    isAdmin: boolean;
};
export type BoardOwnership = {
    user_id: string | null;
};
export declare function canEditBoardPost(post: BoardOwnership, viewer: BoardViewer): boolean;
export declare function canDeleteBoardPost(post: BoardOwnership, viewer: BoardViewer): boolean;
export declare function canPinBoardPost(viewer: BoardViewer): boolean;
export declare function canEditBoardComment(comment: BoardOwnership, viewer: BoardViewer): boolean;
export declare function canDeleteBoardComment(comment: BoardOwnership, viewer: BoardViewer): boolean;
export type BoardInputError = {
    error: string;
};
export type BoardPostInputOk = {
    title: string;
    category: BoardCategorySlug;
    contentHtml: string;
    contentText: string;
};
export declare function validateBoardPostInput(input: {
    title: string;
    category: string;
    sanitizedHtml: string;
}): BoardInputError | BoardPostInputOk;
export declare function validateBoardCommentContent(content: string): BoardInputError | {
    content: string;
};
export declare function boardPreviewText(contentText: string, limit?: number): string;
export declare function resolveBoardCommentParent(target: {
    id: string;
    parent_id: string | null;
}): string;
