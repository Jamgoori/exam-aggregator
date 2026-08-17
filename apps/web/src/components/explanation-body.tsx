// 해설 본문(펼쳤을 때 보이는 내용)과 그 데이터 타입. 카드(서버에서도 그리는 표시용)
// 와 접힘 해설(클라이언트에서 열 때만 그리는 것) 양쪽이 쓰기 때문에 별도 파일로 둔다 —
// "use client" 지시어가 없어야 전체 해설 페이지처럼 서버에서 통째로 그리는 화면이
// 예전처럼 서버 렌더 그대로 남는다.

// 해설 제작 루틴이 만드는 구조화된 해설 한 건. question_explanations 테이블의
// 컬럼을 화면용으로 정규화한 형태다. 모든 필드가 선택적이라 있는 것만 그린다.
// 법령 문항의 해설 본문(text)은 현행법 기준으로 생성되고, 정답 번호는 출제 당시
// 공식 정답을 유지한다. 개정된 선지는 currentStatus="개정됨" + originalNote("출제
// 당시엔 어땠나" 한 줄)로 표시하고, 개정이 정답 자체를 흔드는 문항은
// currentAnswerStatus/currentAnswerNote(문항 전체)와 상단 경고 배너로 알린다.
// lawBasisDate는 이 해설이 참조한 "현행"의 기준 시점.
export type QuestionExplanationContent = {
  keywordTitle: string | null;
  keywordExplanation: string | null;
  choiceExplanations: {
    choice: number;
    text: string;
    currentStatus: string | null; // "유효" | "개정됨" | "확인불가"
    originalNote: string | null; // "개정됨"일 때 "출제 당시엔 어땠나" 한 줄
  }[];
  correctChoiceSummary: string | null;
  lawAmendmentNote: string | null;
  currentAnswerStatus: string | null; // "동일" | "정답변경" | "성립불가"
  currentAnswerNote: string | null; // "정답변경"/"성립불가" 사유
  lawBasisDate: string | null; // 참조한 "현행"의 기준 시점 (예: "2026-07")
};

const CIRCLED_DIGITS = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

// 구조화된 해설 본문: (개정 경고 배너) → 정답 요약 → 핵심 개념 → 선지별 해설
// → 개정 참고 → 현행 기준 시점 순서로, 채워진 항목만 그린다. 정답 선지의 해설
// 줄은 정답 원과 같은 에메랄드로 강조한다. 법령 문항은 "당시 정답"은 그대로 두고
// "지금 법으로는" 정보를 별도 톤으로 얹는다 — 수험생이 폐기된 규정을 그대로
// 외우지 않도록 현행 내용을 눈에 띄게 보여주는 게 핵심이다.
export function ExplanationBody({
  explanation,
  correctChoice,
}: {
  explanation: QuestionExplanationContent;
  correctChoice: number | null;
}) {
  // 개정으로 현행 기준 정답이 흔들리는 문항이 수험생에게 가장 위험하다 —
  // 그래서 이 배너를 카드 맨 위에 크게 띄운다.
  const answerChanged =
    explanation.currentAnswerStatus === "정답변경" ||
    explanation.currentAnswerStatus === "성립불가";

  // select-none: 해설은 약관 제4조로 보호하는 자체 제작 콘텐츠라 드래그 선택·복사를
  // 막는다. 이 컴포넌트는 서버에서도 그리므로(파일 상단 주석) 이벤트 핸들러가 아닌
  // CSS로만 막는다. [-webkit-touch-callout:none] 은 iOS 길게 누르기의 "복사" 팝업을
  // 없앤다. 인쇄(해설 PDF)는 선택과 무관해 그대로 동작한다.
  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700 select-none [-webkit-touch-callout:none] print:mt-1 print:gap-2 print:p-2 print:text-xs print:leading-snug dark:bg-zinc-800/50 dark:text-zinc-300">
      {answerChanged && (
        <div className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-xs text-amber-900 break-inside-avoid dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300">
          <p className="font-bold">
            ⚠️ {explanation.currentAnswerStatus === "성립불가" ? "현행법상 성립하지 않는 문항" : "개정 주의 — 현행 기준 정답이 다릅니다"}
          </p>
          <p className="mt-1 whitespace-pre-wrap">
            표시된 정답 번호는 <strong>출제 당시 공식 정답</strong>이고, 해설은 현행법
            기준으로 작성되었습니다.
            {explanation.currentAnswerNote ? ` ${explanation.currentAnswerNote}` : ""}
          </p>
        </div>
      )}

      {explanation.correctChoiceSummary && (
        <p className="whitespace-pre-wrap break-inside-avoid">
          <span className="mr-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
            정답
          </span>
          {explanation.correctChoiceSummary}
        </p>
      )}

      {(explanation.keywordTitle || explanation.keywordExplanation) && (
        <div className="break-inside-avoid">
          <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-600">핵심 개념</p>
          {explanation.keywordTitle && (
            <p className="mt-0.5 font-semibold text-zinc-800 dark:text-zinc-200">{explanation.keywordTitle}</p>
          )}
          {explanation.keywordExplanation && (
            <p className="mt-1 whitespace-pre-wrap">{explanation.keywordExplanation}</p>
          )}
        </div>
      )}

      {explanation.choiceExplanations.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-600">선지별 해설</p>
          <div className="mt-1 flex flex-col gap-1.5">
            {explanation.choiceExplanations.map((c) => (
              <div key={c.choice} className="break-inside-avoid">
                <p className="whitespace-pre-wrap">
                  <span
                    className={`mr-1 font-semibold ${
                      c.choice === correctChoice ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-600"
                    }`}
                  >
                    {CIRCLED_DIGITS[c.choice] ?? `${c.choice}.`}
                  </span>
                  {c.currentStatus === "개정됨" && (
                    <span className="mr-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                      개정
                    </span>
                  )}
                  {c.text}
                </p>
                {c.originalNote && (
                  <p className="mt-1 ml-5 whitespace-pre-wrap rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                    <span className="font-semibold">출제 당시</span> {c.originalNote}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {explanation.lawAmendmentNote && (
        <p className="whitespace-pre-wrap rounded bg-amber-50 px-2.5 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          개정 참고: {explanation.lawAmendmentNote}
        </p>
      )}

      {explanation.lawBasisDate && (
        <p className="text-[11px] text-zinc-400 dark:text-zinc-600">
          현행법 기준: {explanation.lawBasisDate}
        </p>
      )}
    </div>
  );
}

