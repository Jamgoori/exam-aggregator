import type { SupabaseClient } from "@supabase/supabase-js";
import { type Membership } from "../membership.d.ts";
export type MembershipRow = {
    tier: string | null;
    source: string | null;
    started_at: string | null;
    expires_at: string | null;
};
export declare function startTrialIfEligible(admin: SupabaseClient, userId: string, now?: Date): Promise<MembershipRow | null>;
export declare function getMembership(client: SupabaseClient, userId: string, getAdmin?: () => SupabaseClient): Promise<Membership>;
export declare function isAdminEmail(admin: SupabaseClient, email: string | null | undefined): Promise<boolean>;
export declare function isPremiumUserFor(admin: SupabaseClient, user: {
    userId: string;
    email: string | null;
}, now?: Date): Promise<boolean>;
export declare function kstToday(now?: Date): string;
export type FreeExplanationQuota = {
    allowed: boolean;
    remainingToday: number | null;
};
export declare function consumeFreeExplanationQuota(admin: SupabaseClient, userId: string, paperId: string, now?: Date): Promise<FreeExplanationQuota>;
