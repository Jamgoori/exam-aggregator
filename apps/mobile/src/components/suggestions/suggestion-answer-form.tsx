import { SUGGESTION_ANSWER_MAX } from "@gongmoa/core";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { handleEdgeError } from "../../lib/edge";
import { useAnswerSuggestion } from "../../queries/suggestions";

// 관리자에게만 보이는 답변 입력칸(웹 suggestion-answer-form.tsx 1:1). 이미 답변이 있으면 그 내용을 채워서
// 수정으로 쓴다(답변 이력을 따로 쌓지 않는다 — 건의 하나에 최종 답변 하나면 충분하다). 관리자 판정은 서버
// (EF suggestions answer)가 다시 한다 — 화면은 useAuth().isAdmin 으로 그릴지만 정한다.
export function SuggestionAnswerForm({ suggestionId, initialAnswer }: { suggestionId: string; initialAnswer: string | null }) {
  const answerMutation = useAnswerSuggestion();
  const [answer, setAnswer] = useState(initialAnswer ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (answerMutation.isPending) return;
    setError(null);
    setDone(false);
    try {
      await answerMutation.mutateAsync({ action: "answer", id: suggestionId, answer });
      // 저장 성공 — 상세는 뮤테이션의 무효화로 새로 온다(웹 router.refresh() 자리).
      setDone(true);
    } catch (e) {
      const handled = await handleEdgeError(e, { next: `/suggestions/${suggestionId}` });
      if (!handled.redirected) setError(handled.message);
    }
  }

  return (
    <View className="gap-2 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
      <AppText variant="sm" weight="semibold">
        {initialAnswer ? "답변 수정 (운영자)" : "답변 등록 (운영자)"}
      </AppText>
      {/* 웹 textarea rows=5. */}
      <TextInput
        value={answer}
        onChangeText={setAnswer}
        maxLength={SUGGESTION_ANSWER_MAX}
        placeholder="건의에 대한 답변을 남겨주세요."
        placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
        multiline
        numberOfLines={5}
        textAlignVertical="top"
        maxFontSizeMultiplier={1.3}
        className="min-h-[116px] w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm leading-5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
      {error && (
        <AppText variant="sm" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
          {error}
        </AppText>
      )}
      {done && (
        <AppText variant="sm" accessibilityRole="alert" className="text-green-600 dark:text-green-400">
          답변을 저장했어요.
        </AppText>
      )}
      {/* 웹 `bg-zinc-800 hover:bg-zinc-700` — neutralDark 변형이 그 색이다. */}
      <Button
        variant="neutralDark"
        label={answerMutation.isPending ? "저장 중..." : "답변 저장"}
        pending={answerMutation.isPending}
        onPress={submit}
        className="self-end"
      />
    </View>
  );
}
