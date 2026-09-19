import type { SupabaseClient } from "@supabase/supabase-js";
import { type NoticeViewer } from "../notices.d.ts";
export type NoticeActor = NoticeViewer & {
    userId: string;
    metadataNickname?: unknown;
};
export type NoticeRuleError = {
    error: string;
    status: 400 | 403 | 404 | 429 | 500;
};
export type NoticeDeps = {
    now?: () => Date;
};
export declare function createNoticeComment(client: SupabaseClient, input: {
    actor: NoticeActor;
    noticeId: string;
    content: string;
}, deps?: NoticeDeps): Promise<NoticeRuleError | {
    id: string;
}>;
export declare function updateNoticeComment(client: SupabaseClient, input: {
    actor: NoticeActor;
    commentId: string;
    content: string;
}, deps?: NoticeDeps): Promise<NoticeRuleError | {
    id: string;
}>;
export declare function deleteNoticeComment(client: SupabaseClient, input: {
    actor: NoticeActor;
    commentId: string;
}): Promise<NoticeRuleError | {
    id: string;
}>;
