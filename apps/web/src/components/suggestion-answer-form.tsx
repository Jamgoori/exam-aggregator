"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerSuggestion } from "@/app/suggestions/actions";
import { SUGGESTION_ANSWER_MAX } from "@gongmoa/core";

// 관리자에게만 보이는 답변 입력칸. 이미 답변이 있으면 그 내용을 채워서 수정으로 쓴다
// (답변 이력을 따로 쌓지 않는다 — 건의 하나에 최종 답변 하나면 충분하다).
export function SuggestionAnswerForm({
  suggestionId,
  initialAnswer,
}: {
  suggestionId: string;
  initialAnswer: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [answer, setAnswer] = useState(initialAnswer ?? "");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    startTransition(async () => {
      const result = await answerSuggestion({ id: suggestionId, answer });
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700"
    >
      <p className="text-sm font-semibold">
        {initialAnswer ? "답변 수정 (운영자)" : "답변 등록 (운영자)"}
      </p>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        maxLength={SUGGESTION_ANSWER_MAX}
        rows={5}
        placeholder="건의에 대한 답변을 남겨주세요."
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {done && <p className="text-sm text-green-600 dark:text-green-400">답변을 저장했어요.</p>}
      <button
        type="submit"
        disabled={pending}
        className="self-end rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-700"
      >
        {pending ? "저장 중..." : "답변 저장"}
      </button>
    </form>
  );
}
