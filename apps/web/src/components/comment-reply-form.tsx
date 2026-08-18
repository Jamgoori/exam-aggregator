"use client";

import { useState, useTransition } from "react";
import { postComment } from "@/app/papers/actions";
import { COMMENT_CONTENT_MAX } from "@gongmoa/core";

// 최상위 댓글 아래에 인라인으로 열리는 답글 작성 폼. 댓글과 마찬가지로 로그인한
// 사람만 쓸 수 있어(호출부가 답글 버튼 자체를 감춘다) 닉네임·비밀번호 입력이 없다.
export function ReplyForm({
  paperId,
  parentId,
  onDone,
  onCancel,
}: {
  paperId: string;
  parentId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await postComment({ paperId, parentId, content });
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={COMMENT_CONTENT_MAX}
        placeholder="답글을 입력해주세요"
        required
        rows={2}
        autoFocus
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-500 dark:hover:text-zinc-300"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "등록 중..." : "답글 등록"}
        </button>
      </div>
    </form>
  );
}
