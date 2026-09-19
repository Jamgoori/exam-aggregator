import type { SupabaseClient } from "@supabase/supabase-js";
export declare const ANONYMIZED_NICKNAME = "\uD0C8\uD1F4\uD55C \uD68C\uC6D0";
export declare const DELETED_POST_TITLE = "\uD0C8\uD1F4\uD55C \uD68C\uC6D0\uC758 \uAE00";
export declare const DELETED_POST_TEXT = "\uD0C8\uD1F4\uD55C \uD68C\uC6D0\uC758 \uAE00\uC785\uB2C8\uB2E4.";
export declare const DELETED_CHAT_TEXT = "\uD0C8\uD1F4\uD55C \uD68C\uC6D0\uC758 \uBA54\uC2DC\uC9C0\uC785\uB2C8\uB2E4.";
export declare function deletedPostHtml(): string;
export declare const USER_BUCKETS: readonly ["avatars", "board-images"];
export type AccountDeleteError = {
    error: string;
    status: 500;
};
export type AccountDeleteDeps = {
    log?: (message: string, detail?: unknown) => void;
};
export declare function deleteAccount(client: SupabaseClient, input: {
    userId: string;
}, deps?: AccountDeleteDeps): Promise<AccountDeleteError | {
    ok: true;
}>;
export declare function purgeUserObjects(client: SupabaseClient, userId: string, log: (message: string, detail?: unknown) => void): Promise<void>;
