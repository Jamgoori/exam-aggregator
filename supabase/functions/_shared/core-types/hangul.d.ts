export declare const CONSONANTS: readonly ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
export declare function initialConsonant(text: string): "ㄱ" | "ㄴ" | "ㄷ" | "ㄹ" | "ㅁ" | "ㅂ" | "ㅅ" | "ㅇ" | "ㅈ" | "ㅊ" | "ㅋ" | "ㅌ" | "ㅍ" | "ㅎ" | null;
export declare function toChoseongOnly(text: string): string;
export declare function isChoseongQuery(text: string): boolean;
export declare function matchesChoseong(title: string, query: string): boolean;
