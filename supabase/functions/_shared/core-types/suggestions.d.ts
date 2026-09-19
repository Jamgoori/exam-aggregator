export declare const SUGGESTION_TITLE_MAX = 100;
export declare const SUGGESTION_CONTENT_MAX = 2000;
export declare const SUGGESTION_ANSWER_MAX = 2000;
export declare const SUGGESTION_COMMENT_MAX = 1000;
export declare const SECRET_TITLE_PLACEHOLDER = "\uBE44\uBC00\uAE00\uC785\uB2C8\uB2E4.";
export declare const SUGGESTIONS_PAGE_SIZE = 20;
export type SuggestionViewer = {
    userId: string | null;
    isAdmin: boolean;
};
export type SuggestionOwnership = {
    user_id: string | null;
    is_secret: boolean;
};
export declare function canReadSuggestion(suggestion: SuggestionOwnership, viewer: SuggestionViewer): boolean;
export declare function canEditSuggestion(suggestion: SuggestionOwnership, viewer: SuggestionViewer): boolean;
export declare function canDeleteSuggestion(suggestion: SuggestionOwnership, viewer: SuggestionViewer): boolean;
export declare function canPinSuggestion(viewer: SuggestionViewer): boolean;
export declare function suggestionListTitle(suggestion: SuggestionOwnership & {
    title: string;
}, viewer: SuggestionViewer): string;
export type SuggestionInputError = {
    error: string;
};
export type SuggestionInputOk = {
    title: string;
    content: string;
};
export declare function validateSuggestionInput(input: {
    title: string;
    content: string;
}): SuggestionInputError | SuggestionInputOk;
export declare function validateSuggestionAnswer(answer: string): SuggestionInputError | {
    answer: string;
};
export type SuggestionCommentOwnership = {
    user_id: string | null;
};
export declare function canEditSuggestionComment(comment: SuggestionCommentOwnership, viewer: SuggestionViewer): boolean;
export declare function canDeleteSuggestionComment(comment: SuggestionCommentOwnership, viewer: SuggestionViewer): boolean;
export declare function validateSuggestionCommentContent(content: string): SuggestionInputError | {
    content: string;
};
