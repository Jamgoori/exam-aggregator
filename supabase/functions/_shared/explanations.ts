// 웹 wrong-notes.ts 의 해설 파싱 로직 포팅(normalizeChoiceExplanations/toExplanationContent).
// choice_explanations 는 해설 제작 루틴이 배열/객체 등 여러 모양으로 저장하므로 여기서
// 화면용 형태로 정규화한다.
// deno-lint-ignore-file no-explicit-any

export type NormalizedChoice = {
  choice: number;
  text: string;
  currentStatus: string | null;
  originalNote: string | null;
};

export type QuestionExplanationContent = {
  keywordTitle: string | null;
  keywordExplanation: string | null;
  choiceExplanations: NormalizedChoice[];
  correctChoiceSummary: string | null;
  lawAmendmentNote: string | null;
  currentAnswerStatus: string | null;
  currentAnswerNote: string | null;
  lawBasisDate: string | null;
};

function parseChoiceNumber(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const circled = "①②③④⑤⑥⑦⑧".indexOf(raw.trim().charAt(0));
    if (circled >= 0) return circled + 1;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function normalizeChoiceExplanations(raw: unknown): NormalizedChoice[] {
  if (!raw) return [];

  const textOf = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const t = o.explanation ?? o.text ?? o.content ?? o.reason;
      if (typeof t === "string") return t;
    }
    return "";
  };
  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

  let entries: NormalizedChoice[] = [];
  if (Array.isArray(raw)) {
    entries = raw.map((item, i) => {
      const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        choice: parseChoiceNumber(o.choice ?? o.number ?? o.choice_number, i + 1),
        text: textOf(item),
        currentStatus: strOrNull(o.current_status),
        originalNote: strOrNull(o.original_note),
      };
    });
  } else if (typeof raw === "object") {
    entries = Object.entries(raw as Record<string, unknown>).map(([key, v], i) => ({
      choice: parseChoiceNumber(key, i + 1),
      text: textOf(v),
      currentStatus: null,
      originalNote: null,
    }));
  }

  return entries
    .filter((e) => e.text.trim().length > 0)
    .sort((a, b) => a.choice - b.choice);
}

export function toExplanationContent(row: any): QuestionExplanationContent | null {
  const content: QuestionExplanationContent = {
    keywordTitle: row.keyword_title?.trim() || null,
    keywordExplanation: row.keyword_explanation?.trim() || null,
    choiceExplanations: normalizeChoiceExplanations(row.choice_explanations),
    correctChoiceSummary: row.correct_choice_summary?.trim() || null,
    lawAmendmentNote: row.law_amendment_note?.trim() || null,
    currentAnswerStatus: row.current_answer_status?.trim() || null,
    currentAnswerNote: row.current_answer_note?.trim() || null,
    lawBasisDate: row.law_basis_date?.trim() || null,
  };
  const empty =
    !content.keywordTitle &&
    !content.keywordExplanation &&
    content.choiceExplanations.length === 0 &&
    !content.correctChoiceSummary &&
    !content.lawAmendmentNote &&
    !content.currentAnswerNote;
  return empty ? null : content;
}
