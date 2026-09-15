export declare const NICKNAME_MIN = 2;
export declare const NICKNAME_MAX = 10;
export declare const BANNED_SUBSTRINGS: string[];
export declare function validateNickname(raw: string): {
    nickname: string;
    error: null;
} | {
    nickname: null;
    error: string;
};
export declare const FALLBACK_NICKNAME = "\uD68C\uC6D0";
export declare function authorNickname(metadataNickname: unknown): string;
