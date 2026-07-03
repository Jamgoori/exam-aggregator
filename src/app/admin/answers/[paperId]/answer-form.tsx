"use client";

import { useActionState } from "react";
import { savePaperAnswers, type SaveAnswersState } from "@/app/admin/actions";

const initialState: SaveAnswersState = {};

export function AnswerForm({
  paperId,
  initialAnswers,
  questionCount,
}: {
  paperId: string;
  initialAnswers: string;
  questionCount: number | null;
}) {
  const [state, action, pending] = useActionState(savePaperAnswers, initialState);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="paper_id" value={paperId} />

      <div className="flex flex-col gap-1">
        <label htmlFor="answers" className="text-sm text-zinc-600">
          정답 (1번부터 순서대로, 쉼표나 공백으로 구분)
        </label>
        <textarea
          id="answers"
          name="answers"
          required
          rows={4}
          defaultValue={initialAnswers}
          placeholder="2, 4, 1, 3, 5, ..."
          className="rounded border border-zinc-300 px-3 py-2 font-mono"
        />
        {questionCount && (
          <p className="text-xs text-zinc-400">
            문항 수 {questionCount}개 — 순서대로 {questionCount}개를 입력해주세요.
            5번 정답이 있으면 CBT 화면에 자동으로 5지선다로 표시돼요.
          </p>
        )}
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state?.success && (
        <p className="text-sm text-green-600">저장되었습니다.</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
