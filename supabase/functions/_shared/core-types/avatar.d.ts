export declare const AVATAR_MAX_BYTES: number;
export declare const AVATAR_SIZE = 256;
export declare const AVATAR_ALLOWED_MIME: readonly ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
export declare function isAllowedAvatarMime(mime: string): boolean;
export declare function avatarUploadError(file: {
    type: string;
    size: number;
}): string | null;
export declare function avatarInitial(nickname: string): string;
export declare function isValidAvatarPath(path: unknown): path is string;
export declare function avatarPublicUrl(supabaseUrl: string, path: string | null | undefined): string | null;
export declare const AVATAR_ENCODED_MAX_BYTES: number;
export declare const AVATAR_BASE64_MAX_CHARS: number;
export declare const AVATAR_PATHS_MAX = 200;
export type WebpInfo = {
    width: number;
    height: number;
    animated: boolean;
};
export declare function readWebpInfo(bytes: Uint8Array): WebpInfo | null;
export declare function avatarBytesError(bytes: Uint8Array): string | null;
export declare function avatarUrlMap(supabaseUrl: string, rows: readonly {
    user_id: string;
    avatar_path: string | null;
}[] | null | undefined): Map<string, string>;
