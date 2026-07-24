"use client";

import { useState, useTransition } from "react";
import { updateComment } from "@/app/papers/actions";
import { COMMENT_CONTENT_MAX } from "@gongmoa/core";
import type { Comment } from "@gongmoa/core";

// 댓글을 그 자리에서 고치는 편집 폼. 비회원 댓글이면 비밀번호로 소유권을 확인한다.
export function EditRow({
  comment,
  requiresPassword,
  onDone,
  onCancel,
}: {
  comment: Comment;
  requiresPassword: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(comment.content);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateComment({
        commentId: comment.id,
        content,
        password: requiresPassword ? password : undefined,
      });
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={COMMENT_CONTENT_MAX}
        rows={3}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
      />
      <div className="flex flex-wrap items-center gap-2">
        {requiresPassword && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700"
          />
        )}
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          저장
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-zinc-500 dark:text-zinc-500"
        >
          취소
        </button>
        {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
