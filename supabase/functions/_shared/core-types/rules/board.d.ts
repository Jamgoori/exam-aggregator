import type { SupabaseClient } from "@supabase/supabase-js";
import { type BoardViewer } from "../board.d.ts";
export type BoardActor = BoardViewer & {
    userId: string;
    metadataNickname?: unknown;
};
export type BoardRuleError = {
    error: string;
    status: 400 | 403 | 404 | 429 | 500;
};
export type BoardDeps = {
    imageOrigin: string;
    now?: () => Date;
    randomUuid?: () => string;
};
export declare const BOARD_RAW_HTML_MAX: number;
export type BoardPostWriteInput = {
    actor: BoardActor;
    title: string;
    category: string;
    contentHtml: string;
    isPinned?: boolean;
};
export declare function createBoardPost(client: SupabaseClient, input: BoardPostWriteInput, deps: BoardDeps): Promise<BoardRuleError | {
    id: string;
}>;
export declare function updateBoardPost(client: SupabaseClient, input: BoardPostWriteInput & {
    id: string;
}, deps: BoardDeps): Promise<BoardRuleError | {
    id: string;
}>;
export declare function deleteBoardPost(client: SupabaseClient, input: {
    actor: BoardActor;
    id: string;
}): Promise<BoardRuleError | {
    id: string;
}>;
export declare function uploadBoardImage(client: SupabaseClient, input: {
    userId: string;
    webp: Uint8Array;
}, deps: BoardDeps): Promise<BoardRuleError | {
    url: string;
}>;
export declare function createBoardComment(client: SupabaseClient, input: {
    actor: BoardActor;
    postId: string;
    content: string;
    parentId?: string | null;
}, deps: BoardDeps): Promise<BoardRuleError | {
    id: string;
}>;
export declare function updateBoardComment(client: SupabaseClient, input: {
    actor: BoardActor;
    commentId: string;
    content: string;
}, deps: BoardDeps): Promise<BoardRuleError | {
    id: string;
}>;
export declare function deleteBoardComment(client: SupabaseClient, input: {
    actor: BoardActor;
    commentId: string;
}, deps: BoardDeps): Promise<BoardRuleError | {
    id: string;
}>;
