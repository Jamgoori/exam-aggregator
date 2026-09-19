export declare const NOTICE_TITLE_MAX = 100;
export declare const NOTICE_CONTENT_MAX = 5000;
export declare const NOTICE_COMMENT_MAX = 1000;
export type NoticeInputError = {
    error: string;
};
export type NoticeInputOk = {
    title: string;
    content: string;
};
export declare function validateNoticeInput(input: {
    title: string;
    content: string;
}): NoticeInputError | NoticeInputOk;
export type NoticeViewer = {
    userId: string | null;
    isAdmin: boolean;
};
export type NoticeCommentOwnership = {
    user_id: string;
};
export declare function canEditNoticeComment(comment: NoticeCommentOwnership, viewer: NoticeViewer): boolean;
export declare function canDeleteNoticeComment(comment: NoticeCommentOwnership, viewer: NoticeViewer): boolean;
export declare function validateNoticeCommentContent(content: string): NoticeInputError | {
    content: string;
};
