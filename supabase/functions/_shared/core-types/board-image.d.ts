export declare const BOARD_IMAGE_MAX_BYTES: number;
export declare const BOARD_IMAGE_ALLOWED_MIME: readonly ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
export declare function isAllowedBoardImageMime(mime: string): boolean;
export declare const BOARD_IMAGE_MAX_WIDTH = 1600;
export declare const BOARD_IMAGE_MAX_PIXELS: number;
export declare const BOARD_IMAGE_ENCODED_MAX_BYTES: number;
export declare const BOARD_IMAGE_BASE64_MAX_CHARS: number;
export declare function boardImageOrigin(supabaseUrl: string): string;
export declare function boardImageUploadError(file: {
    type: string;
    size: number;
} | null): string | null;
export declare function boardImageBytesError(bytes: Uint8Array): string | null;
