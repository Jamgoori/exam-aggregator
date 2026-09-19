export declare const RICH_TEXT_HTML_MAX = 30000;
declare const ALLOWED_TAGS: {
    readonly p: readonly [];
    readonly br: readonly [];
    readonly div: readonly [];
    readonly span: readonly [];
    readonly b: readonly [];
    readonly strong: readonly [];
    readonly i: readonly [];
    readonly em: readonly [];
    readonly u: readonly [];
    readonly s: readonly [];
    readonly strike: readonly [];
    readonly h2: readonly [];
    readonly h3: readonly [];
    readonly blockquote: readonly [];
    readonly ul: readonly [];
    readonly ol: readonly [];
    readonly li: readonly [];
    readonly pre: readonly [];
    readonly code: readonly [];
    readonly hr: readonly [];
    readonly a: readonly ["href", "target", "rel"];
    readonly img: readonly ["src", "alt"];
};
export declare const RICH_TEXT_TAGS: readonly RichTextTag[];
export type RichTextTag = keyof typeof ALLOWED_TAGS;
export type SanitizeRichTextOptions = {
    imageOrigins?: readonly string[];
};
export declare function sanitizeRichText(html: string, options?: SanitizeRichTextOptions): string;
export type RichNode = {
    type: "text";
    text: string;
} | {
    type: "element";
    tag: RichTextTag;
    attrs: Record<string, string>;
    children: RichNode[];
};
export declare function parseRichText(html: string): RichNode[];
export declare function richTextNodesToText(nodes: readonly RichNode[]): string;
export declare function richTextToPlain(html: string): string;
export declare function firstImageSrc(html: string): string | null;
export declare function hasRichTextBody(html: string): boolean;
export {};
