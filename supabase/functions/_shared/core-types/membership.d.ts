export declare const TRIAL_DAYS = 60;
export declare const FREE_UNTIL = "2027-07-01T00:00:00+09:00";
export declare const FREE_UNTIL_LABEL = "2027\uB144 6\uC6D4 30\uC77C";
export declare function isFreeForAll(now?: Date): boolean;
export declare function trialExpiresAt(now?: Date): Date;
export declare const FREE_EXPLANATION_DAILY_PAPERS = 3;
export type MembershipTier = "free" | "premium";
export type MembershipSource = "trial" | "paid" | "attendance";
export type Membership = {
    tier: MembershipTier;
    source: MembershipSource;
    startedAt: string | null;
    expiresAt: string | null;
};
export declare const FREE_MEMBERSHIP: Membership;
export declare function isPremiumMembership(membership: Membership | null | undefined, now?: Date): boolean;
export declare function hasOwnPremiumPeriod(membership: Membership | null | undefined, now?: Date): boolean;
export declare function isAdFreeMembership(membership: Membership | null | undefined, now?: Date): boolean;
export declare function trialDaysLeft(membership: Membership | null | undefined, now?: Date): number | null;
export declare function attendanceDaysLeft(membership: Membership | null | undefined, now?: Date): number | null;
export declare function membershipDaysLeft(membership: Membership | null | undefined, now?: Date): number | null;
export declare function isTrialUnstarted(membership: Membership | null | undefined): boolean;
export declare function membershipFromRow(row: {
    tier?: string | null;
    source?: string | null;
    started_at?: string | null;
    expires_at?: string | null;
} | null): Membership;
