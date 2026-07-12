import { ChevronRight } from "lucide-react";

// 오답노트 화면(회차별/과목별)이 공유하는 문제 카드. 훅을 쓰지 않는 순수 표시용
// 컴포넌트라 서버 컴포넌트(회차 페이지)와 클라이언트 컴포넌트(과목 페이지의 필터
// 목록) 어느 쪽에서든 그대로 가져다 쓸 수 있다.

// 해설 제작 루틴이 만드는 구조화된 해설 한 건. question_explanations 테이블의
// 컬럼을 화면용으로 정규화한 형태다. 모든 필드가 선택적이라 있는 것만 그린다.
// 법령 문항은 "출제 당시 정답"은 그대로 두고, "지금 법으로는 어떤가"를 현행 필드로
// 분리해 담는다 — choiceExplanations의 currentStatus/currentNote(선지별)와
// currentAnswerStatus/currentAnswerNote(문항 전체), lawBasisDate(현행 기준 시점).
export type QuestionExplanationContent = {
  keywordTitle: string | null;
  keywordExplanation: string | null;
  choiceExplanations: {
    choice: number;
    text: string;
    currentStatus: string | null; // "유효" | "개정됨" | "확인불가"
    currentNote: string | null; // "개정됨"일 때 현행 내용 한 줄
  }[];
  correctChoiceSummary: string | null;
  lawAmendmentNote: string | null;
  currentAnswerStatus: string | null; // "동일" | "정답변경" | "성립불가"
  currentAnswerNote: string | null; // "정답변경"/"성립불가" 사유
  lawBasisDate: string | null; // 참조한 "현행"의 기준 시점 (예: "2026-07")
};

// 카드 하나에 들어가는 답 줄. 세트문제(공통지문)는 이미지 한 벌에 답 줄이 여러 개 붙는다.
export type WrongNoteCardRow = {
  questionNumber: number;
  selectedChoice: number | null;
  correctChoice: number | null;
  choiceCount: number;
  // 해설이 등록된 문항만 채워진다 (없으면 "해설 보기" 자체가 안 뜬다).
  explanation?: QuestionExplanationContent | null;
  // 과목별 모아보기에서만 채워지는 값들 (회차별 보기에서는 undefined).
  wrongCount?: number;
  resolved?: boolean;
};

// CBT 문제별 보기(cbt-solver)와 같은 규칙으로 세트문제를 묶는다: 크롭 스크립트가
// 세트에 속한 문제들에 완전히 같은 이미지 경로를 저장하므로, 연속된 오답의 이미지
// 배열이 동일하면 같은 지문을 두 번 그리지 않고 카드 하나로 합친다.
export function groupRowsBySharedImages<T extends { images: string[] }>(
  items: T[],
): { images: string[]; rows: T[] }[] {
  const groups: { images: string[]; rows: T[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.images.length > 0 &&
      item.images.length === last.images.length &&
      item.images.every((src, i) => src === last.images[i])
    ) {
      last.rows.push(item);
    } else {
      groups.push({ images: item.images, rows: [item] });
    }
  }
  return groups;
}

// 정답(초록)/내가 고른 답(빨강) 색은 CBT 채점 화면(single-question-view)과 동일하게
// 맞춰서, 시험을 막 마친 사용자가 오답노트에서도 같은 문법으로 읽을 수 있게 한다.
function ChoiceRow({
  row,
  showNumberBadge,
  showSelection,
}: {
  row: WrongNoteCardRow;
  showNumberBadge: boolean;
  showSelection: boolean;
}) {
  // 전체 해설 페이지처럼 "내가 고른 답" 개념이 없는 화면에서는 풀지 않음 배지를 숨긴다.
  const skipped = showSelection && row.selectedChoice === null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {showNumberBadge && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-white">
          {row.questionNumber}
        </span>
      )}
      <div className="flex gap-1.5">
        {Array.from({ length: row.choiceCount }, (_, c) => c + 1).map((choice) => {
          const isCorrect = row.correctChoice === choice;
          const isMyWrongPick = !isCorrect && row.selectedChoice === choice;
          return (
            <span
              key={choice}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                isCorrect
                  ? "bg-emerald-500 text-white"
                  : isMyWrongPick
                    ? "bg-red-500 text-white"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
              }`}
            >
              {choice}
            </span>
          );
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {skipped && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
            풀지 않음
          </span>
        )}
        {row.wrongCount !== undefined && row.wrongCount >= 2 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            {row.wrongCount}번 틀림
          </span>
        )}
        {row.resolved && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
            극복
          </span>
        )}
      </div>
    </div>
  );
}

export function WrongNoteQuestionCard({
  rows,
  images,
  // 전체 해설 페이지용 옵션: 해설을 펼친 채로 시작하고(복습이 아니라 열람이 목적),
  // "내가 고른 답"/"풀지 않음" 표시는 숨긴다.
  explanationsOpen = false,
  showSelection = true,
}: {
  rows: WrongNoteCardRow[];
  images: string[];
  explanationsOpen?: boolean;
  showSelection?: boolean;
}) {
  const firstNumber = rows[0]?.questionNumber;
  const lastNumber = rows[rows.length - 1]?.questionNumber;
  const numberLabel =
    firstNumber === lastNumber ? `${firstNumber}번` : `${firstNumber}~${lastNumber}번`;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/50">
        <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{numberLabel}</span>
      </div>

      {images.length > 0 ? (
        <div className="flex flex-col">
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt={`${numberLabel} 문제 이미지 ${i + 1}`}
              loading="lazy"
              className="w-full"
            />
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
          아직 이 문제의 이미지가 등록되지 않았어요. 문제 내용은 원본 문제지에서
          확인해주세요.
        </p>
      )}

      <div className="flex flex-col gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
        {rows.map((row) => (
          <ChoiceRow
            key={row.questionNumber}
            row={row}
            showNumberBadge={rows.length > 1}
            showSelection={showSelection}
          />
        ))}
      </div>

      {/* 해설: 먼저 스스로 다시 풀어보게 기본은 접어두고, 누르면 펼친다. 서버/클라이언트
          어느 트리에서든 그대로 동작해야 해서 JS 없는 네이티브 details/summary를 쓴다. */}
      {rows.some((row) => row.explanation) && (
        <div className="flex flex-col gap-1 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
          {rows
            .filter((row) => row.explanation)
            .map((row) => (
              <details key={row.questionNumber} open={explanationsOpen} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-blue-600 hover:underline [&::-webkit-details-marker]:hidden dark:text-blue-400">
                  <ChevronRight
                    size={14}
                    className="shrink-0 transition-transform group-open:rotate-90"
                  />
                  {rows.length > 1 ? `${row.questionNumber}번 해설 보기` : "해설 보기"}
                </summary>
                <ExplanationBody
                  explanation={row.explanation!}
                  correctChoice={row.correctChoice}
                />
              </details>
            ))}
        </div>
      )}
    </div>
  );
}

const CIRCLED_DIGITS = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

// 구조화된 해설 본문: (개정 경고 배너) → 정답 요약 → 핵심 개념 → 선지별 해설
// → 개정 참고 → 현행 기준 시점 순서로, 채워진 항목만 그린다. 정답 선지의 해설
// 줄은 정답 원과 같은 에메랄드로 강조한다. 법령 문항은 "당시 정답"은 그대로 두고
// "지금 법으로는" 정보를 별도 톤으로 얹는다 — 수험생이 폐기된 규정을 그대로
// 외우지 않도록 현행 내용을 눈에 띄게 보여주는 게 핵심이다.
function ExplanationBody({
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

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-lg bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
      {answerChanged && (
        <div className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300">
          <p className="font-bold">
            ⚠️ {explanation.currentAnswerStatus === "성립불가" ? "현행법상 성립하지 않는 문항" : "개정 주의 — 현행 기준 정답이 다릅니다"}
          </p>
          <p className="mt-1 whitespace-pre-wrap">
            아래 정답·해설은 <strong>출제 당시 공식 정답</strong> 기준입니다.
            {explanation.currentAnswerNote ? ` ${explanation.currentAnswerNote}` : ""}
          </p>
        </div>
      )}

      {explanation.correctChoiceSummary && (
        <p className="whitespace-pre-wrap">
          <span className="mr-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
            정답
          </span>
          {explanation.correctChoiceSummary}
        </p>
      )}

      {(explanation.keywordTitle || explanation.keywordExplanation) && (
        <div>
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
              <div key={c.choice}>
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
                {c.currentNote && (
                  <p className="mt-1 ml-5 whitespace-pre-wrap rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                    <span className="font-semibold">현행</span> {c.currentNote}
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

// 초록=정답, 빨강=내가 고른 답 규칙을 화면마다 한 번씩 설명해주는 범례.
export function WrongNoteLegend() {
  return (
    <p className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-500">
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        정답
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
        내가 고른 답
      </span>
    </p>
  );
}
