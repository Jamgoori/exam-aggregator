import type { SupabaseClient } from "@supabase/supabase-js";
import { type DedupablePaper, type PaperIdentitySignal } from "../dedup-papers.d.ts";
import type { ExamPaper, Subject } from "../types.d.ts";
export type PaperCore = {
    id: string;
    title: string;
    level: string | null;
    track: string | null;
    year: number;
    round: number;
    subject_id: string;
    exam_type_id: string;
};
export type LightPaper = PaperCore & {
    subjects: {
        id: string;
        name: string;
        slug: string;
    } | null;
    exam_types: {
        id: string;
        name: string;
    } | null;
};
export type PaperWire = [
    string,
    string,
    string | null,
    string | null,
    number,
    number,
    number,
    number
];
export type ExamTypeRef = {
    id: string;
    name: string;
};
export type HomePayload = {
    subjects: Subject[];
    examTypes: ExamTypeRef[];
    papers: PaperWire[];
};
export declare function encodePapers(papers: PaperCore[], subjects: Subject[], examTypes: ExamTypeRef[]): PaperWire[];
export declare function decodePapers({ subjects, examTypes, papers }: HomePayload): LightPaper[];
export declare function getExamTypeNames(papers: LightPaper[]): string[];
export declare function filterPapers(papers: LightPaper[], { level, year, examType, matchedSubjectIds, isSearching, favOnly, bookmarkedSubjectIds, }: {
    level?: string;
    year?: number;
    examType?: string;
    matchedSubjectIds: string[];
    isSearching: boolean;
    favOnly?: boolean;
    bookmarkedSubjectIds?: Set<string>;
}): LightPaper[];
export declare function groupByYearAndSubject(papers: LightPaper[]): Map<number, Map<string, LightPaper[]>>;
export declare function fetchExamPaperRows(client: SupabaseClient): Promise<{
    rows: PaperCore[];
    examTypes: ExamTypeRef[];
}>;
export declare function fetchPaperIdentitySignalsRpc(client: SupabaseClient, papers: DedupablePaper[]): Promise<Map<string, PaperIdentitySignal>>;
export declare function fetchQuestionCountSignals(client: SupabaseClient, papers: DedupablePaper[]): Promise<Map<string, PaperIdentitySignal>>;
export type SignalsProvider = (client: SupabaseClient, papers: DedupablePaper[]) => Promise<Map<string, PaperIdentitySignal>>;
export declare function fetchCbtAvailability(client: SupabaseClient, paperIds: string[]): Promise<Set<string>>;
export declare function fetchAllCbtAvailability(client: SupabaseClient): Promise<Set<string>>;
export type Catalog = HomePayload & {
    cbtMask: string;
    slugMap: Record<string, string>;
};
export declare function fetchCatalog(client: SupabaseClient, signalsProvider: SignalsProvider): Promise<Catalog>;
export type SubjectIndexEntry = {
    slug: string;
    name: string;
    /** 중복 시험지를 합친 뒤의 자료 수 — 홈·과목 페이지에 보이는 개수와 같다. */
    count: number;
    minYear: number;
    maxYear: number;
};
export declare function buildSubjectIndex(subjects: Subject[], papers: {
    subject_id: string;
    year: number;
}[]): {
    entries: SubjectIndexEntry[];
    totalCount: number;
};
export type ExamTypeOption = {
    id: string;
    name: string;
    display_order: number;
};
export declare function fetchSubjectFilters(client: SupabaseClient, subjectId: string): Promise<{
    levels: string[];
    examTypes: ExamTypeOption[];
    hasAnyPaper: boolean;
}>;
export declare function fetchSubjectPapers(client: SupabaseClient, subjectId: string, filter: {
    level?: string;
    examTypeIds?: string[];
}, signalsProvider: SignalsProvider): Promise<ExamPaper[]>;
export declare function fetchMyRoundCounts(client: SupabaseClient, userId: string): Promise<Map<string, number>>;
