// 문항 해설 본문 정규화 — 웹 lib/wrong-notes.ts 와 Edge explanations-get 이 같은 함수를
// 쓴다(예전엔 Edge _shared/explanations.ts 에 복사본이 있었다).
//
// 해설 자체는 question_explanations(관리자 전용 RLS)에서 service_role 로만 읽는다.
// 이 파일은 그 행을 화면용 구조로 바꾸는 순수 계산만 담는다 — 조회는 호출부 몫.

export type NormalizedChoiceExplanation = {
  choice: number;
  text: string;
  currentStatus: string | null;
  originalNote: string | null;
};

// 화면(웹 wrong-note-question-card·앱 해설 카드)이 그리는 문항 해설 한 건.
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

// 선지 번호가 "①"/"1번"/객체/배열 등 어떤 형태로 저장돼 있어도 숫자로 되살린다.
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

// choice_explanations는 해설 제작 루틴이 jsonb로 저장한다. 배열([문자열] 또는
// [{choice, explanation}]) / 객체({"1": "..."} 또는 {"①": "..."}) 어느 형태로
// 들어와도 화면용 목록으로 정규화한다. 법령 문항 선지는 항목에 current_status
// ("유효"/"개정됨"/"확인불가")와 original_note(개정됨일 때 "출제 당시엔 어땠나"
// 한 줄)가 더 붙는데, 있을 때만 실어 보낸다(없으면 null — 화면이 있는 것만 그린다).
// 해설 본문(explanation)은 현행법 기준으로 생성된다 — 프롬프트 참조.
export function normalizeChoiceExplanations(raw: unknown): NormalizedChoiceExplanation[] {
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

  let entries: NormalizedChoiceExplanation[] = [];
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

// question_explanations 에서 화면이 쓰는 컬럼. 조회 select 문자열과 행 타입을 여기서
// 함께 둔다 — 컬럼을 하나 더 그리려면 둘을 같이 고쳐야 한다.
export const EXPLANATION_CONTENT_COLUMNS =
  "keyword_title, keyword_explanation, choice_explanations, correct_choice_summary, law_amendment_note, current_answer_status, current_answer_note, law_basis_date";

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

// DB 행 → 화면용 해설. 내용이 하나도 없는 행(빈 해설)은 null 로 떨어뜨려 호출부가
// "해설 없음"으로 다루게 한다.
export function toExplanationContent(row: ExplanationRow): QuestionExplanationContent | null {
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
