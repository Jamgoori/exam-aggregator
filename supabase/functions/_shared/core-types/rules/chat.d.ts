import type { SupabaseClient } from "@supabase/supabase-js";
export type ChatActor = {
    userId: string;
    metadataNickname?: unknown;
};
export type ChatSentMessage = {
    id: string;
    userId: string;
    nickname: string;
    content: string;
    createdAt: string;
};
export type ChatRuleError = {
    error: string;
    status: 400 | 429 | 500;
};
export type ChatDeps = {
    now?: () => Date;
};
export declare function sendChatMessage(client: SupabaseClient, input: {
    actor: ChatActor;
    content: string;
}, deps?: ChatDeps): Promise<ChatRuleError | {
    message: ChatSentMessage;
}>;
