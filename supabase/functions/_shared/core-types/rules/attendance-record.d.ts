import type { SupabaseClient } from "@supabase/supabase-js";
export declare function recordAttendance(admin: SupabaseClient, userId: string, questionCount: number, opts?: {
    now?: Date;
}): Promise<void>;
