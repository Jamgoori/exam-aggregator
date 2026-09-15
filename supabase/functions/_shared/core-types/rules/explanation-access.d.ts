import type { SupabaseClient } from "@supabase/supabase-js";
export declare const EXPLANATION_VIEW_HOURLY_LIMIT = 40;
export declare const EXPLANATION_DOWNLOAD_HOURLY_LIMIT = 80;
export declare const ANON_PREVIEW_CARDS = 2;
export type ExplanationAccessAction = "view" | "download";
export type ExplanationAccess = {
    full: boolean;
    reason: "rate-limit" | "free-quota" | null;
    remainingToday: number | null;
};
export declare function resolveExplanationAccess(admin: SupabaseClient, input: {
    userId: string;
    paperId: string;
    action: ExplanationAccessAction;
    premium: boolean;
    now?: Date;
}): Promise<ExplanationAccess>;
