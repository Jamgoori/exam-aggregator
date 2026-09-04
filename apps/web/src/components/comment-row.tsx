"use client";

import { useState, useTransition } from "react";
import { deleteComment } from "@/app/papers/actions";
import type { Comment } from "@gongmoa/core";
import { KST_TIME_ZONE } from "@gongmoa/core";

// 댓글 한 줄(닉네임/날짜/본문 + 답글·수정·삭제 버튼). 삭제는 실수 방지를 위해
// 같은 자리에서 한 번 더 확인받고, 비회원 댓글이면 비밀번호까지 받아 검증한다.
export function CommentRow({
  comment,
  canEdit,
  canDelete,
  isAdmin,
  onEdit,
  onDeleted,
  canReply,
  isReplying,
  onToggleReply,
}: {
  comment: Comment;
  canEdit: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  onEdit: () => void;
  onDeleted: () => void;
  canReply: boolean;
  isReplying: boolean;
  onToggleReply: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const requiresPassword = comment.user_id === null && !isAdmin;

  function doDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteComment({
        commentId: comment.id,
        password: requiresPassword ? password : undefined,
      });
      if (result.error) setError(result.error);
      else onDeleted();
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-bold">{comment.nickname}</span>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-600">
            {new Date(comment.created_at).toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE })}
            {comment.updated_at ? " (수정됨)" : ""}
          </span>
        </div>
        {(canReply || canEdit || canDelete) && (
          <div className="flex gap-2 text-[11px] text-zinc-400 dark:text-zinc-600">
            {canReply && (
              <button
                type="button"
                onClick={onToggleReply}
                className={isReplying ? "text-blue-600 dark:text-blue-400" : "hover:text-blue-600 dark:hover:text-blue-400"}
              >
                답글
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="hover:text-blue-600 dark:hover:text-blue-400"
              >
                수정
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => setConfirming((v) => !v)}
                className="hover:text-red-600 dark:hover:text-red-400"
              >
                삭제
              </button>
            )}
          </div>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
        {comment.content}
      </p>

      {confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
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
            onClick={doDelete}
            disabled={pending}
            className="rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            삭제 확인
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            className="text-sm text-zinc-500 dark:text-zinc-500"
          >
            취소
          </button>
          {error && <p className="w-full text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
