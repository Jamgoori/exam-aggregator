"use client";

// OMR 답안 표기 패널. 데스크톱에서는 시험지 오른쪽에 고정으로, 모바일에서는
// "답안 입력" 버튼으로 여는 좌우 분할 패널(전체보기)이나 바텀시트(문제별 풀기)
// 안에 같은 컴포넌트가 들어간다.
// 채점이 끝나면(resultByQuestion) 문항별 정오답 색으로 바뀌고 입력이 잠긴다.
export function OmrPanel({
  className,
  compact = false,
  totalQuestions,
  choiceCount,
  answers,
  answeredCount,
  onSelect,
  onSubmit,
  submitting,
  error,
  resultByQuestion,
}: {
  className: string;
  // 모바일 좌우 분할처럼 폭이 좁은 자리에 들어갈 때 여백을 줄인다.
  compact?: boolean;
  totalQuestions: number;
  choiceCount: number;
  answers: (number | null)[];
  answeredCount: number;
  onSelect: (questionIndex: number, choice: number) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  resultByQuestion: Map<
    number,
    { selected_choice: number | null; is_correct: boolean }
  > | null;
}) {
  const graded = !!resultByQuestion;
  const padX = compact ? "px-2" : "px-4";

  return (
    <div className={className}>
      <div className={`shrink-0 border-b border-zinc-100 py-2 dark:border-zinc-700 ${padX}`}>
        <p className="text-xs text-zinc-500 sm:text-sm dark:text-zinc-500">
          {answeredCount}/{totalQuestions} 문항 표기
        </p>
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto py-2 ${padX}`}>
        <div className="grid grid-cols-1 gap-1.5">
          {Array.from({ length: totalQuestions }, (_, i) => {
            const questionNumber = i + 1;
            const selected = answers[i];
            const questionResult = resultByQuestion?.get(questionNumber);
            return (
              <div
                key={questionNumber}
                className={`flex items-center rounded-lg border py-1 ${
                  compact ? "gap-1 px-1" : "gap-2 px-2"
                } ${
                  graded
                    ? questionResult?.is_correct
                      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/30"
                      : "border-red-200 bg-red-50 dark:border-red-800/60 dark:bg-red-950/30"
                    : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-white dark:bg-zinc-700">
                  {questionNumber}
                </span>
                <div className={`flex flex-1 ${compact ? "gap-0.5" : "gap-1"}`}>
                  {Array.from({ length: choiceCount }, (_, c) => c + 1).map(
                    (choice) => (
                      <button
                        key={choice}
                        type="button"
                        disabled={graded}
                        onClick={() => onSelect(i, choice)}
                        className={`flex h-6 flex-1 items-center justify-center rounded text-xs font-medium ${
                          selected === choice
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                        } disabled:cursor-default disabled:hover:bg-zinc-100 dark:disabled:hover:bg-zinc-800`}
                      >
                        {choice}
                      </button>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div
        className={`shrink-0 border-t border-zinc-100 dark:border-zinc-700 ${padX} ${
          compact ? "py-2" : "py-3"
        }`}
      >
        {error && (
          <p className={`mb-2 text-red-600 dark:text-red-400 ${compact ? "text-xs" : "text-sm"}`}>
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || graded}
          className={`w-full rounded-xl bg-blue-600 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700 ${
            compact ? "px-2 py-2.5 text-xs" : "px-4 py-3 text-sm"
          }`}
        >
          {graded ? "채점 완료" : submitting ? "채점 중..." : "제출하고 채점하기"}
        </button>
      </div>
    </div>
  );
}
