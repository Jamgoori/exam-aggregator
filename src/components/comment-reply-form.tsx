"use client";

import { useState, useTransition } from "react";
import { postComment } from "@/app/papers/actions";
import { CommentGuestFields } from "@/components/comment-guest-fields";
import { COMMENT_CONTENT_MAX } from "@/lib/comment-constraints";

// 최상위 댓글 아래에 인라인으로 열리는 답글 작성 폼.
export function ReplyForm({
  paperId,
  parentId,
  loggedIn,
  onDone,
  onCancel,
}: {
  paperId: string;
  parentId: string;
  loggedIn: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await postComment({
        paperId,
        parentId,
        content,
        nickname: loggedIn ? undefined : nickname,
        password: loggedIn ? undefined : password,
      });
      if (result.error) setError(result.error);
      else onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      {!loggedIn && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <CommentGuestFields
            nickname={nickname}
            password={password}
            onNicknameChange={setNickname}
            onPasswordChange={setPassword}
          />
        </div>
      )}
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
