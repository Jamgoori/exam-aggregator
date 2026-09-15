export declare const PROFANITY_WORDS: string[];
export declare const PROFANITY_ALLOWED_PHRASES: string[];
export declare const PROFANITY_ERROR = "\uBE44\uC18D\uC5B4\u00B7\uC695\uC124\uC774 \uD3EC\uD568\uB418\uC5B4 \uC788\uC5B4 \uB4F1\uB85D\uD560 \uC218 \uC5C6\uC5B4\uC694.";
export declare function normalizeForProfanityCheck(raw: string): string;
export declare function findProfanity(text: string): string | null;
export declare function containsProfanity(text: string): boolean;
export declare function profanityError(text: string): string | null;
