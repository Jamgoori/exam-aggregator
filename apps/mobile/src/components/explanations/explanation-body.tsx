import type { QuestionExplanationContent } from "@gongmoa/core";
import { View } from "react-native";
import { AppText } from "../app-text";

export type { QuestionExplanationContent };

const CIRCLED_DIGITS = ["", "①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧"];

// 구조화된 해설 본문(웹 explanation-body.tsx, 설계서 §4.5 #24): (개정 경고 배너) → 정답 요약 →
// 핵심 개념 → 선지별 해설 → 개정 참고 → 현행 기준 시점 순서로 채워진 항목만 그린다.
// 해설은 약관 제4조로 보호하는 자체 제작 콘텐츠라 모든 글자가 selectable={false}(웹 select-none).
export function ExplanationBody({
  explanation,
  correctChoice,
}: {
  explanation: QuestionExplanationContent;
  correctChoice: number | null;
}) {
  const answerChanged =
    explanation.currentAnswerStatus === "정답변경" || explanation.currentAnswerStatus === "성립불가";
  const body = "text-zinc-700 dark:text-zinc-300";

  return (
    <View className="mt-2 gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
      {answerChanged && (
        <View className="rounded-md border border-amber-300 bg-amber-100 px-3 py-2 dark:border-amber-800/60 dark:bg-amber-950/40">
          <AppText variant="xs" weight="bold" selectable={false} className="text-amber-900 dark:text-amber-300">
            ⚠️ {explanation.currentAnswerStatus === "성립불가" ? "현행법상 성립하지 않는 문항" : "개정 주의 — 현행 기준 정답이 다릅니다"}
          </AppText>
          <AppText variant="xs" selectable={false} className="mt-1 text-amber-900 dark:text-amber-300" pretty>
            표시된 정답 번호는{" "}
            <AppText variant="xs" weight="bold" selectable={false} className="text-amber-900 dark:text-amber-300">
              출제 당시 공식 정답
            </AppText>
            이고, 해설은 현행법 기준으로 작성되었습니다.
            {explanation.currentAnswerNote ? ` ${explanation.currentAnswerNote}` : ""}
          </AppText>
        </View>
      )}

      {explanation.correctChoiceSummary && (
        <View className="flex-row flex-wrap items-start">
          <View className="mr-1.5 rounded bg-emerald-100 px-1.5 py-0.5 dark:bg-emerald-950/30">
            <AppText variant="xs" weight="semibold" selectable={false} allowFontScaling={false} className="text-emerald-700 dark:text-emerald-400">
              정답
            </AppText>
          </View>
          <AppText variant="sm" selectable={false} className={["min-w-0 flex-1 leading-relaxed", body].join(" ")} pretty>
            {explanation.correctChoiceSummary}
          </AppText>
        </View>
      )}

      {(explanation.keywordTitle || explanation.keywordExplanation) && (
        <View>
          <AppText variant="xs" weight="semibold" selectable={false} className="text-zinc-400 dark:text-zinc-600">
            핵심 개념
          </AppText>
          {explanation.keywordTitle && (
            <AppText variant="sm" weight="semibold" selectable={false} className="mt-0.5 leading-relaxed text-zinc-800 dark:text-zinc-200">
              {explanation.keywordTitle}
            </AppText>
          )}
          {explanation.keywordExplanation && (
            <AppText variant="sm" selectable={false} className={["mt-1 leading-relaxed", body].join(" ")} pretty>
              {explanation.keywordExplanation}
            </AppText>
          )}
        </View>
      )}

      {explanation.choiceExplanations.length > 0 && (
        <View>
          <AppText variant="xs" weight="semibold" selectable={false} className="text-zinc-400 dark:text-zinc-600">
            선지별 해설
          </AppText>
          <View className="mt-1 gap-1.5">
            {explanation.choiceExplanations.map((c) => (
              <View key={c.choice}>
                <AppText variant="sm" selectable={false} className={["leading-relaxed", body].join(" ")} pretty>
                  <AppText
                    variant="sm"
                    weight="semibold"
                    selectable={false}
                    className={c.choice === correctChoice ? "text-emerald-600 dark:text-emerald-400" : "text-zinc-400 dark:text-zinc-600"}
                  >
                    {CIRCLED_DIGITS[c.choice] ?? `${c.choice}.`}{" "}
                  </AppText>
                  {c.currentStatus === "개정됨" && (
                    <AppText variant="10" weight="bold" selectable={false} className="rounded bg-amber-100 px-1 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                      개정{" "}
                    </AppText>
                  )}
                  {c.text}
                </AppText>
                {c.originalNote && (
                  <View className="mt-1 ml-5 rounded bg-amber-50 px-2 py-1.5 dark:bg-amber-950/20">
                    <AppText variant="xs" selectable={false} className="text-amber-800 dark:text-amber-300" pretty>
                      <AppText variant="xs" weight="semibold" selectable={false} className="text-amber-800 dark:text-amber-300">
                        출제 당시
                      </AppText>{" "}
                      {c.originalNote}
                    </AppText>
                  </View>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {explanation.lawAmendmentNote && (
        <View className="rounded bg-amber-50 px-2.5 py-2 dark:bg-amber-950/30">
          <AppText variant="xs" selectable={false} className="text-amber-700 dark:text-amber-400" pretty>
            개정 참고: {explanation.lawAmendmentNote}
          </AppText>
        </View>
      )}

      {explanation.lawBasisDate && (
        <AppText variant="11" selectable={false} className="text-zinc-400 dark:text-zinc-600">
          현행법 기준: {explanation.lawBasisDate}
        </AppText>
      )}
    </View>
  );
}
