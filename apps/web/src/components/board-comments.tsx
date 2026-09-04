"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CornerDownRight, MessageSquare } from "lucide-react";
import { Avatar } from "@/components/user-menu";
import {
  createBoardComment,
  deleteBoardComment,
  updateBoardComment,
} from "@/app/board/actions";
import { BOARD_COMMENT_MAX } from "@gongmoa/core";
import type { BoardCommentItem } from "@/lib/board";

// 자유게시판 댓글. 답글은 1단계까지만 들어간다(더 깊어지면 좁은 화면에서
// 들여쓰기가 감당이 안 된다 — 서버도 같은 규칙으로 부모를 접어 올린다).

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BoardComments({
  postId,
  comments,
  commentCount,
  loggedIn,
}: {
  postId: string;
  comments: BoardCommentItem[];
  commentCount: number;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // 지금 답글을 쓰고 있는 댓글 / 수정 중인 댓글. 한 번에 하나만 열린다.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createBoardComment({ postId, content });
      if (result.error) {
        setError(result.error);
        return;
      }
      setContent("");
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="flex items-center gap-1.5 text-base font-bold">
        <MessageSquare size={16} className="text-blue-600 dark:text-blue-400" />
        댓글 {commentCount}
      </h2>

      {loggedIn ? (
        <form onSubmit={submitNew} className="flex flex-col gap-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={BOARD_COMMENT_MAX}
            placeholder="댓글을 남겨보세요"
            required
            rows={3}
            className="w-full resize-y rounded-xl border border-zinc-300 px-3.5 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
              {content.length} / {BOARD_COMMENT_MAX}
            </span>
            <button
              type="submit"
              disabled={pending}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? "등록 중…" : "댓글 등록"}
            </button>
          </div>
        </form>
      ) : (
        <p className="rounded-xl bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
          <Link href="/login" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            로그인
          </Link>
          하면 댓글을 남길 수 있어요.
        </p>
      )}

      <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
        {comments.length === 0 && (
          <li className="py-10 text-center text-sm text-zinc-400 dark:text-zinc-500">
            아직 댓글이 없어요. 첫 댓글을 남겨보세요.
          </li>
        )}

        {comments.map((comment) => (
          <li key={comment.id} className="py-3.5">
            <CommentRow
              comment={comment}
              postId={postId}
              loggedIn={loggedIn}
              editing={editingId === comment.id}
              onEdit={() => setEditingId(comment.id)}
              onEditDone={() => setEditingId(null)}
              replying={replyTo === comment.id}
              onReply={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
              onReplyDone={() => setReplyTo(null)}
            />

            {comment.replies.length > 0 && (
              <ul className="mt-2 flex flex-col gap-2 border-l-2 border-zinc-100 pl-3 dark:border-zinc-800">
                {comment.replies.map((reply) => (
                  <li key={reply.id} className="flex gap-1.5">
                    <CornerDownRight
                      size={14}
                      aria-hidden
                      className="mt-2 shrink-0 text-zinc-300 dark:text-zinc-600"
                    />
                    <div className="min-w-0 flex-1">
                      <CommentRow
                        comment={reply}
                        postId={postId}
                        loggedIn={loggedIn}
                        editing={editingId === reply.id}
                        onEdit={() => setEditingId(reply.id)}
                        onEditDone={() => setEditingId(null)}
                        // 답글에는 다시 답글을 달 수 없다(1단계 규칙) — 대신 원
                        // 댓글의 "답글" 버튼이 같은 자리를 맡는다.
                        replying={false}
                        onReply={null}
                        onReplyDone={() => setReplyTo(null)}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CommentRow({
  comment,
  postId,
  loggedIn,
  editing,
  onEdit,
  onEditDone,
  replying,
  onReply,
  onReplyDone,
}: {
  comment: BoardCommentItem;
  postId: string;
  loggedIn: boolean;
  editing: boolean;
  onEdit: () => void;
  onEditDone: () => void;
  replying: boolean;
  onReply: (() => void) | null;
  onReplyDone: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(comment.content);
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (comment.isDeleted) {
    return (
      <p className="py-1 text-sm text-zinc-400 italic dark:text-zinc-500">
        삭제된 댓글입니다.
      </p>
    );
  }

  function saveEdit() {
    setError(null);
    startTransition(async () => {
      const result = await updateBoardComment({ commentId: comment.id, content: draft });
      if (result.error) {
        setError(result.error);
        return;
      }
      onEditDone();
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm("댓글을 삭제할까요?")) return;
    startTransition(async () => {
      const result = await deleteBoardComment(comment.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function submitReply(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createBoardComment({
        postId,
        content: replyText,
        parentId: comment.id,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setReplyText("");
      onReplyDone();
      router.refresh();
    });
  }

  return (
    <div id={`comment-${comment.id}`} className="flex flex-col gap-1.5 scroll-mt-24">
      <div className="flex items-center gap-2">
        <Avatar nickname={comment.nickname} avatarUrl={comment.avatarUrl} size="sm" />
        <span className="text-[13px] font-semibold">{comment.nickname}</span>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {formatDateTime(comment.createdAt)}
        </span>
        {comment.updatedAt && (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">(수정됨)</span>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={BOARD_COMMENT_MAX}
            rows={3}
            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onEditDone}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              취소
            </button>
            <button
              type="button"
              onClick={saveEdit}
              disabled={pending}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-6 whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
          {comment.content}
        </p>
      )}

      {!editing && (
        <div className="flex gap-3 text-[11px] text-zinc-400 dark:text-zinc-500">
          {onReply && loggedIn && (
            <button
              type="button"
              onClick={onReply}
              className="font-medium hover:text-blue-600 dark:hover:text-blue-400"
            >
              {replying ? "답글 취소" : "답글"}
            </button>
          )}
          {comment.canEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="hover:text-blue-600 dark:hover:text-blue-400"
            >
              수정
            </button>
          )}
          {comment.canDelete && (
            <button
              type="button"
              onClick={remove}
              className="hover:text-red-600 dark:hover:text-red-400"
            >
              삭제
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {replying && (
        <form onSubmit={submitReply} className="mt-1 flex flex-col gap-2">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            maxLength={BOARD_COMMENT_MAX}
            placeholder={`${comment.nickname}님에게 답글 남기기`}
            required
            rows={2}
            autoFocus
            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onReplyDone}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              답글 등록
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
