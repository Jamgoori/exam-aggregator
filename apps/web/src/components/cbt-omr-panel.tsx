"use client";

import { memo } from "react";

// OMR 답안 표기 패널. 데스크톱에서는 시험지 오른쪽에 고정으로, 모바일에서는
// "답안 입력" 버튼으로 여는 바텀시트 안에 같은 컴포넌트가 들어간다.
// 채점이 끝나면(resultByQuestion) 문항별 정오답 색으로 바뀌고 입력이 잠긴다.
//
// memo 로 감싸는 이유: 부모(CbtSolver)는 경과 시간 때문에 1초마다 다시 그려지는데,
// 이 패널은 문항 20~40개 × 선지 4~5개 = 버튼 수백 개짜리 격자다. 모바일에서 답안
// 시트까지 열어두면 두 벌이 뜬다. 100분짜리 시험이면 틱만 6000번이라, 답과 아무
// 상관없이 이 격자를 6000번 다시 만들게 된다 — 필기 캔버스(pointermove)와 같은
// 메인 스레드를 쓰므로 중저가 기기에서는 그게 필기 지연으로 나타난다.
// props 가 실제로 바뀔 때(답 선택·채점·에러)만 다시 그리면 된다. 그래서 부모는
// onSelect/onSubmit 을 useCallback 으로, resultByQuestion 을 useMemo 로 넘긴다 —
// 셋 중 하나라도 매 렌더 새로 만들면 이 memo 는 그냥 무효가 된다.
function OmrPanelImpl({
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
      <div className="shrink-0 border-b border-zinc-100 px-4 py-2 dark:border-zinc-700">
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
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
                      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/30"
                      : "border-red-200 bg-red-50 dark:border-red-800/60 dark:bg-red-950/30"
                    : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-white dark:bg-zinc-700">
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

      <div className="shrink-0 border-t border-zinc-100 px-4 py-3 dark:border-zinc-700">
        {error && <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || graded}
          className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
        >
          {graded ? "채점 완료" : submitting ? "채점 중..." : "제출하고 채점하기"}
        </button>
      </div>
    </div>
  );
}

export const OmrPanel = memo(OmrPanelImpl);
