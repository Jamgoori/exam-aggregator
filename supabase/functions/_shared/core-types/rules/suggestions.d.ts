import type { SupabaseClient } from "@supabase/supabase-js";
import { type SuggestionViewer } from "../suggestions.d.ts";
export type SuggestionActor = SuggestionViewer & {
    userId: string;
    metadataNickname?: unknown;
};
export type SuggestionRuleError = {
    error: string;
    status: 400 | 403 | 404 | 429 | 500;
};
export type SuggestionDeps = {
    now?: () => Date;
};
export type SuggestionListItem = {
    id: string;
    title: string;
    nickname: string;
    createdAt: string;
    viewCount: number;
    isSecret: boolean;
    isPinned: boolean;
    isAnswered: boolean;
    readable: boolean;
    authorId: string | null;
};
export type SuggestionDetail = {
    id: string;
    title: string;
    content: string;
    nickname: string;
    createdAt: string;
    updatedAt: string | null;
    viewCount: number;
    isSecret: boolean;
    isPinned: boolean;
    answer: string | null;
    answeredAt: string | null;
    authorId: string | null;
    canEdit: boolean;
    canDelete: boolean;
};
export type SuggestionCommentItem = {
    id: string;
    nickname: string;
    content: string;
    createdAt: string;
    updatedAt: string | null;
    canEdit: boolean;
    canDelete: boolean;
    authorId: string | null;
};
export type SuggestionPage = {
    items: SuggestionListItem[];
    pinnedItems: SuggestionListItem[];
    total: number;
    totalPages: number;
};
export declare function fetchSuggestionPage(client: SupabaseClient, page: number, viewer: SuggestionViewer): Promise<SuggestionPage>;
export type FetchSuggestionResult = {
    status: "ok";
    suggestion: SuggestionDetail;
} | {
    status: "not_found";
} | {
    status: "forbidden";
};
export declare function fetchSuggestion(client: SupabaseClient, id: string, viewer: SuggestionViewer): Promise<FetchSuggestionResult>;
export declare function countSuggestionView(client: SupabaseClient, id: string, viewer: SuggestionViewer, authorId: string | null): Promise<void>;
export declare function fetchSuggestionComments(client: SupabaseClient, suggestionId: string, viewer: SuggestionViewer): Promise<SuggestionCommentItem[]>;
export type ReadSuggestionCommentsResult = {
    status: "ok";
    items: SuggestionCommentItem[];
} | {
    status: "not_found";
} | {
    status: "forbidden";
};
export declare function readSuggestionComments(client: SupabaseClient, suggestionId: string, viewer: SuggestionViewer): Promise<ReadSuggestionCommentsResult>;
export type SuggestionWriteInput = {
    actor: SuggestionActor;
    title: string;
    content: string;
    isSecret: boolean;
    isPinned?: boolean;
};
export declare function createSuggestion(client: SupabaseClient, input: SuggestionWriteInput, deps?: SuggestionDeps): Promise<SuggestionRuleError | {
    id: string;
}>;
export declare function updateSuggestion(client: SupabaseClient, input: SuggestionWriteInput & {
    id: string;
}, deps?: SuggestionDeps): Promise<SuggestionRuleError | {
    id: string;
}>;
export declare function deleteSuggestion(client: SupabaseClient, input: {
    actor: SuggestionActor;
    id: string;
}): Promise<SuggestionRuleError | {
    id: string;
}>;
export declare function answerSuggestion(client: SupabaseClient, input: {
    actor: SuggestionActor;
    id: string;
    answer: string;
}, deps?: SuggestionDeps): Promise<SuggestionRuleError | {
    id: string;
}>;
export declare function createSuggestionComment(client: SupabaseClient, input: {
    actor: SuggestionActor;
    suggestionId: string;
    content: string;
}, deps?: SuggestionDeps): Promise<SuggestionRuleError | {
    id: string;
}>;
export declare function updateSuggestionComment(client: SupabaseClient, input: {
    actor: SuggestionActor;
    commentId: string;
    content: string;
}, deps?: SuggestionDeps): Promise<SuggestionRuleError | {
    id: string;
}>;
export declare function deleteSuggestionComment(client: SupabaseClient, input: {
    actor: SuggestionActor;
    commentId: string;
}): Promise<SuggestionRuleError | {
    id: string;
}>;
