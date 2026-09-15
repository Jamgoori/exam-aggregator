export type ExamLevelTierInput = {
    level: string | null | undefined;
    examTypeName: string | null | undefined;
    track?: string | null;
};
export declare function examLevelTier(paper: ExamLevelTierInput): string | null;
export declare function isApproxLevelTier(paper: ExamLevelTierInput): boolean;
