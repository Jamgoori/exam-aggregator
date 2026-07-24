"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { saveQuestionMemo } from "@/app/mypage/wrong-notes/actions";

// 문항별 개인 메모. 접힌 "메모" 버튼을 누르면 입력창이 열리고, 저장하면 서버에
// upsert(빈 값이면 삭제)한다. 오답노트 모아보기 카드 아래에 문항마다 하나씩.
export function MemoEditor({
  paperId,
  questionNumber,
  initialMemo,
  label,
}: {
  paperId: string;
  questionNumber: number;
  initialMemo: string | null;
  // 세트문제처럼 카드에 문항이 여러 개면 번호로 구분.
  label?: string;
}) {
  const [memo, setMemo] = useState(initialMemo ?? "");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(memo);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await saveQuestionMemo({ paperId, questionNumber, memo: draft });
      if (res.error) {
        setError(res.error);
        return;
      }
      setMemo(res.memo ?? "");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(memo);
          setOpen(true);
        }}
        className="flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
      >
        <Pencil size={12} className="mt-0.5 shrink-0" />
        {memo ? (
          <span className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
            {label && <span className="mr-1 font-semibold">{label}</span>}
            {memo}
          </span>
        ) : (
          <span>{label ? `${label} 메모 추가` : "메모 추가"}</span>
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 px-2 py-1.5">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        maxLength={2000}
        autoFocus
        placeholder={label ? `${label} 메모` : "이 문항에 대한 메모"}
        className="w-full resize-y rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? "저장 중..." : "저장"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          취소
        </button>
      </div>
    </div>
  );
}
