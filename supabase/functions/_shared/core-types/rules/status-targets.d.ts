import type { SupabaseClient } from "@supabase/supabase-js";
export type StatusTargetItem = {
    paperId: string;
    questionNumber: number;
};
export declare function statusTargetKey(paperId: string, questionNumber: number): string;
export type ResolveStatusTargetsOptions = {
    answersClient?: SupabaseClient | null;
};
export declare function resolveStatusTargets(client: SupabaseClient, userId: string, items: StatusTargetItem[], opts?: ResolveStatusTargetsOptions): Promise<Map<string, string[]>>;
