import type { SupabaseClient } from "@supabase/supabase-js";
export type AvatarUploadInput = {
    userId: string;
    webp: Uint8Array;
    metadataNickname?: unknown;
};
export type AvatarChangeResult = {
    error: string;
    status: 400 | 500;
} | {
    avatarPath: string | null;
};
export type AvatarDeps = {
    randomUuid?: () => string;
};
export declare function uploadUserAvatar(client: SupabaseClient, input: AvatarUploadInput, deps?: AvatarDeps): Promise<AvatarChangeResult>;
export declare function removeUserAvatar(client: SupabaseClient, input: {
    userId: string;
}): Promise<AvatarChangeResult>;
