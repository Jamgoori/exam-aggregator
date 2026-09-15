export type NormalizedChoiceExplanation = {
    choice: number;
    text: string;
    currentStatus: string | null;
    originalNote: string | null;
};
export type QuestionExplanationContent = {
    keywordTitle: string | null;
    keywordExplanation: string | null;
    choiceExplanations: NormalizedChoiceExplanation[];
    correctChoiceSummary: string | null;
    lawAmendmentNote: string | null;
    currentAnswerStatus: string | null;
    currentAnswerNote: string | null;
    lawBasisDate: string | null;
};
export declare function normalizeChoiceExplanations(raw: unknown): NormalizedChoiceExplanation[];
export declare const EXPLANATION_CONTENT_COLUMNS = "keyword_title, keyword_explanation, choice_explanations, correct_choice_summary, law_amendment_note, current_answer_status, current_answer_note, law_basis_date";
export type ExplanationRow = {
    keyword_title: string | null;
    keyword_explanation: string | null;
    choice_explanations: unknown;
    correct_choice_summary: string | null;
    law_amendment_note: string | null;
    current_answer_status: string | null;
    current_answer_note: string | null;
    law_basis_date: string | null;
};
export declare function toExplanationContent(row: ExplanationRow): QuestionExplanationContent | null;
