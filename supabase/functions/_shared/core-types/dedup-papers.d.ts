export type DedupablePaper = {
    id: string;
    subject_id: string;
    exam_type_id: string;
    year: number;
    round: number;
    level: string | null;
    title: string;
    track?: string | null;
    created_at?: string;
};
export type PaperIdentitySignal = {
    questionCount: number;
    answerSignature: string | null;
    answerLength: number | null;
};
export declare function paperDedupKey(p: DedupablePaper): string;
export declare function collidingPaperIds(papers: DedupablePaper[]): string[];
export declare function representativePaperIds<T extends DedupablePaper>(papers: T[], signals?: Map<string, PaperIdentitySignal>): {
    repByPaperId: Map<string, string>;
    finalGroupSizeByRepId: Map<string, number>;
};
export declare function collapseDuplicatePapers<T extends DedupablePaper>(papers: T[], signals?: Map<string, PaperIdentitySignal>): T[];
