"use client";

// OMR 답안 표기 패널. 데스크톱에서는 시험지 오른쪽에 고정으로, 모바일에서는
// "답안 입력" 버튼으로 여는 바텀시트 안에 같은 컴포넌트가 들어간다.
// 채점이 끝나면(resultByQuestion) 문항별 정오답 색으로 바뀌고 입력이 잠긴다.
export function OmrPanel({
  className,
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

  return (
    <div className={className}>
      <div className="shrink-0 border-b border-zinc-100 px-4 py-2">
        <p className="text-sm text-zinc-500">
          {answeredCount}/{totalQuestions} 문항 표기
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <div className="grid grid-cols-1 gap-1.5">
          {Array.from({ length: totalQuestions }, (_, i) => {
            const questionNumber = i + 1;
            const selected = answers[i];
            const questionResult = resultByQuestion?.get(questionNumber);
            return (
              <div
                key={questionNumber}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${
                  graded
                    ? questionResult?.is_correct
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-red-200 bg-red-50"
                    : "border-zinc-200"
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-white">
                  {questionNumber}
                </span>
                <div className="flex flex-1 gap-1">
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
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                        } disabled:cursor-default disabled:hover:bg-zinc-100`}
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

      <div className="shrink-0 border-t border-zinc-100 px-4 py-3">
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || graded}
          className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {graded ? "채점 완료" : submitting ? "채점 중..." : "제출하고 채점하기"}
        </button>
      </div>
    </div>
  );
}
