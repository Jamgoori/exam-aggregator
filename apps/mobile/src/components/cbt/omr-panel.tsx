import { memo } from "react";
import { FlatList, Pressable, View } from "react-native";
import { AppText } from "../app-text";
import type { CbtQuestionResult } from "./use-cbt-state";

// OMR 답안 표기 패널(웹 cbt-omr-panel.tsx 1:1). 문제별 풀기에서는 Sheet(rounded-t-2xl, max 65%)
// 안에, 전체보기 좌우 분할(Phase 2)에서는 compact 로 들어간다. 채점이 끝나면(resultByQuestion)
// 행이 정오답 색으로 바뀌고 입력이 잠긴다.
//
// **패널은 문제지 단위 choiceCount** 를 쓴다(문제별 뷰만 문항별 questionChoiceCounts) — 둘을
// 통일하면 웹과 달라진다(설계서 §4.5 #22).
export type OmrPanelProps = {
  className?: string;
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
  resultByQuestion: Map<number, CbtQuestionResult> | null;
};

const OmrRow = memo(function OmrRow({
  questionNumber,
  selected,
  choiceCount,
  graded,
  isCorrect,
  compact,
  onSelect,
}: {
  questionNumber: number;
  selected: number | null;
  choiceCount: number;
  graded: boolean;
  isCorrect: boolean | undefined;
  compact: boolean;
  onSelect: (questionIndex: number, choice: number) => void;
}) {
  const rowTone = graded
    ? isCorrect
      ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/30"
      : "border-red-200 bg-red-50 dark:border-red-800/60 dark:bg-red-950/30"
    : "border-zinc-200 dark:border-zinc-700";
  return (
    <View
      className={["flex-row items-center rounded-lg border py-1", compact ? "gap-1 px-1" : "gap-2 px-2", rowTone].join(" ")}
    >
      <View className="h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 dark:bg-zinc-700">
        <AppText variant="xs" weight="bold" className="text-white" allowFontScaling={false}>
          {questionNumber}
        </AppText>
      </View>
      <View className={["flex-1 flex-row", compact ? "gap-0.5" : "gap-1"].join(" ")}>
        {Array.from({ length: choiceCount }, (_, c) => c + 1).map((choice) => {
          const isSelected = selected === choice;
          return (
            <Pressable
              key={choice}
              accessibilityRole="button"
              accessibilityLabel={`${questionNumber}번 ${choice}번 선택지`}
              accessibilityState={{ selected: isSelected, disabled: graded }}
              disabled={graded}
              onPress={() => onSelect(questionNumber - 1, choice)}
              className={[
                "h-6 flex-1 items-center justify-center rounded",
                isSelected
                  ? "bg-blue-600"
                  : "bg-zinc-100 active:bg-zinc-200 dark:bg-zinc-800 dark:active:bg-zinc-700",
              ].join(" ")}
            >
              <AppText
                variant="xs"
                weight="medium"
                className={isSelected ? "text-white" : "text-zinc-600 dark:text-zinc-400"}
                allowFontScaling={false}
              >
                {choice}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
});

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
}: OmrPanelProps) {
  const graded = !!resultByQuestion;
  const padX = compact ? "px-2" : "px-4";
  const buttonLabel = graded ? "채점 완료" : submitting ? "채점 중..." : "제출하고 채점하기";
  const buttonDisabled = submitting || graded;

  return (
    <View className={["min-h-0 shrink", className ?? ""].join(" ")}>
      <View className={["shrink-0 border-b border-zinc-100 py-2 dark:border-zinc-700", padX].join(" ")}>
        <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
          {answeredCount}/{totalQuestions} 문항 표기
        </AppText>
      </View>

      <FlatList
        className="min-h-0 shrink"
        data={Array.from({ length: totalQuestions }, (_, i) => i + 1)}
        keyExtractor={(n) => String(n)}
        contentContainerClassName={["gap-1.5 py-2", padX].join(" ")}
        initialNumToRender={12}
        renderItem={({ item: questionNumber }) => (
          <OmrRow
            questionNumber={questionNumber}
            selected={answers[questionNumber - 1] ?? null}
            choiceCount={choiceCount}
            graded={graded}
            isCorrect={resultByQuestion?.get(questionNumber)?.is_correct}
            compact={compact}
            onSelect={onSelect}
          />
        )}
      />

      <View
        className={["shrink-0 border-t border-zinc-100 dark:border-zinc-700", padX, compact ? "py-2" : "py-3"].join(" ")}
      >
        {error && (
          <AppText variant={compact ? "xs" : "sm"} className="mb-2 text-red-600 dark:text-red-400" pretty>
            {error}
          </AppText>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: buttonDisabled, busy: submitting }}
          disabled={buttonDisabled}
          onPress={onSubmit}
          className={[
            "w-full items-center rounded-xl",
            buttonDisabled ? "bg-zinc-300 dark:bg-zinc-700" : "bg-blue-600 active:bg-blue-700",
            compact ? "px-2 py-2.5" : "px-4 py-3",
          ].join(" ")}
        >
          <AppText variant={compact ? "xs" : "sm"} weight="semibold" className="text-white">
            {buttonLabel}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
