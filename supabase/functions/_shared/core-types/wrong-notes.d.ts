import type { ExamType, Subject } from "./types.d.ts";
export type WrongNotePaperInfo = {
    id: string;
    title: string;
    level: string | null;
    round: number;
    track: string | null;
    choice_count: number;
    subjects: Subject | null;
    exam_types: ExamType | null;
};
export type WrongNoteAttemptRow = {
    id: string;
    created_at: string;
    score?: number;
    total_questions?: number;
    exam_papers: WrongNotePaperInfo | null;
};
export type WrongNoteQuestionSummary = {
    questionNumber: number;
    wrongCount: number;
    resolved: boolean;
    lastSelectedChoice: number | null;
};
export type WrongNotePaperGroup = {
    paper: WrongNotePaperInfo;
    attemptCount: number;
    lastAttemptAt: string;
    latestScore: number | null;
    latestTotal: number | null;
    questions: WrongNoteQuestionSummary[];
    unresolvedCount: number;
    resolvedCount: number;
};
export type WrongNoteSubjectGroup = {
    subject: Subject;
    papers: WrongNotePaperGroup[];
    unresolvedCount: number;
    resolvedCount: number;
};
export type WrongAnswerRow = {
    attempt_id: string;
    question_number: number;
    selected_choice: number | null;
};
export type WrongNoteMarks = {
    deleted: Set<string>;
    pinned: Set<string>;
};
export declare const EMPTY_MARKS: WrongNoteMarks;
export declare const WRONGRATE_MIN_SAMPLE = 10;
export declare function wrongRatePct(attempts: number, wrongs: number): number | null;
export declare const ROUND_AVERAGE_MIN_SAMPLE = 5;
export declare function othersRoundAveragePct(attempts: number, pctSum: number, myPct: number | null): number | null;
export declare function buildWrongNoteGroups(attempts: WrongNoteAttemptRow[], wrongRows: WrongAnswerRow[], deletedKeys?: Set<string>, statusOverrides?: Map<string, boolean>): WrongNoteSubjectGroup[];
