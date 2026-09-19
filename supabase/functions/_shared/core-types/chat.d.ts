export declare const CHAT_CONTENT_MAX = 300;
export declare function chatContentError(content: string): string | null;
export declare const CHAT_MIN_INTERVAL_MS = 1500;
export declare const CHAT_BURST_WINDOW_MS = 10000;
export declare const CHAT_BURST_LIMIT = 5;
export type ChatGuardResult = {
    ok: true;
} | {
    ok: false;
    error: string;
};
export declare function checkChatFlood(lastMessage: {
    content: string;
    createdAtMs: number;
} | null, content: string, nowMs: number): ChatGuardResult;
export declare function checkChatBurst(recentCount: number): ChatGuardResult;
export declare const CHAT_CLEAR_CONFIRM_TEXT = "\uCC44\uD305 \uCD08\uAE30\uD654";
export declare function checkChatClearConfirmation(input: string): ChatGuardResult;
