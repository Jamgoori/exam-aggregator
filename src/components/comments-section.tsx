"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  postComment,
  updateComment,
  deleteComment,
} from "@/app/papers/actions";
import type { Comment } from "@/lib/supabase/types";

const NICKNAME_MAX = 10;
const CONTENT_MAX = 2000;
const PW_MIN = 4;
const PW_MAX = 16;

export function CommentsSection({
  paperId,
  comments,
  currentUserId,
  loggedIn,
  isAdmin = false,
}: {
  paperId: string;
  comments: Comment[];
  currentUserId: string | null;
  loggedIn: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 작성 폼 상태
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [content, setContent] = useState("");

  // 편집/답글 작성 중인 댓글
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);

  // 답글은 최상위 댓글에만 달리므로(1단계 깊이 제한), 최상위 댓글별로 답글 목록을 묶어둔다.
  const topLevelComments = comments.filter((c) => !c.parent_id);
  const repliesByParent = new Map<string, Comment[]>();
  for (const c of comments) {
    if (!c.parent_id) continue;
    const list = repliesByParent.get(c.parent_id) ?? [];
    list.push(c);
    repliesByParent.set(c.parent_id, list);
  }

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await postComment({
        paperId,
        content,
        nickname: loggedIn ? undefined : nickname,
        password: loggedIn ? undefined : password,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setNickname("");
        setPassword("");
        setContent("");
        router.refresh();
      }
    });
  }

  function renderRow(
    comment: Comment,
    opts: { canReply: boolean; isReplying: boolean },
  ) {
    if (editingId === comment.id) {
      return (
        <EditRow
          comment={comment}
          requiresPassword={comment.user_id === null}
          onDone={() => {
            setEditingId(null);
            router.refresh();
          }}
          onCancel={() => setEditingId(null)}
        />
      );
    }
    return (
      <CommentRow
        comment={comment}
        canEdit={comment.user_id === null || comment.user_id === currentUserId}
        canDelete={
          isAdmin || comment.user_id === null || comment.user_id === currentUserId
        }
        isAdmin={isAdmin}
        onEdit={() => setEditingId(comment.id)}
        onDeleted={() => router.refresh()}
        canReply={opts.canReply}
        isReplying={opts.isReplying}
        onToggleReply={() =>
          setReplyingToId((v) => (v === comment.id ? null : comment.id))
        }
      />
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">댓글 {comments.length}개</h2>

      <form onSubmit={submitNew} className="flex flex-col gap-3">
        {!loggedIn && (
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={NICKNAME_MAX}
              placeholder={`닉네임 (최대 ${NICKNAME_MAX}자)`}
              required
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm sm:w-40"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={PW_MIN}
              maxLength={PW_MAX}
              placeholder={`비밀번호 (${PW_MIN}~${PW_MAX}자)`}
              required
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm sm:w-52"
            />
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={CONTENT_MAX}
          placeholder="이 시험에 대한 의견을 남겨주세요"
          required
          rows={3}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="self-end rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "등록 중..." : "댓글 등록"}
        </button>
      </form>

      <div className="flex flex-col divide-y divide-zinc-100">
        {topLevelComments.length === 0 && (
          <p className="py-10 text-center text-sm text-zinc-500">
            아직 댓글이 없어요. 첫 댓글을 남겨보세요.
          </p>
        )}
        {topLevelComments.map((comment) => {
          const replies = repliesByParent.get(comment.id) ?? [];
          return (
            <div key={comment.id} className="py-5">
              {renderRow(comment, {
                canReply: true,
                isReplying: replyingToId === comment.id,
              })}

              {replies.length > 0 && (
                <div className="mt-4 ml-6 flex flex-col gap-4 border-l-2 border-zinc-100 pl-4">
                  {replies.map((reply) => (
                    <div key={reply.id}>
                      {renderRow(reply, { canReply: false, isReplying: false })}
                    </div>
                  ))}
                </div>
              )}

              {replyingToId === comment.id && (
                <div className="mt-4 ml-6 border-l-2 border-zinc-100 pl-4">
                  <ReplyForm
                    paperId={paperId}
                    parentId={comment.id}
                    loggedIn={loggedIn}
                    onDone={() => {
                      setReplyingToId(null);
                      router.refresh();
                    }}
                    onCancel={() => setReplyingToId(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CommentRow({
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
          <span className="text-[11px] text-zinc-400">
            {new Date(comment.created_at).toLocaleDateString("ko-KR")}
            {comment.updated_at ? " (수정됨)" : ""}
          </span>
        </div>
        {(canReply || canEdit || canDelete) && (
          <div className="flex gap-2 text-[11px] text-zinc-400">
            {canReply && (
              <button
                type="button"
                onClick={onToggleReply}
                className={isReplying ? "text-blue-600" : "hover:text-blue-600"}
              >
                답글
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="hover:text-blue-600"
              >
                수정
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => setConfirming((v) => !v)}
                className="hover:text-red-600"
              >
                삭제
              </button>
            )}
          </div>
        )}
      </div>
      <p className="whitespace-pre-wrap text-sm text-zinc-700">
        {comment.content}
      </p>

      {confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-3">
          {requiresPassword && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              className="rounded border border-zinc-300 px-2 py-1 text-sm"
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
            className="text-sm text-zinc-500"
          >
            취소
          </button>
          {error && <p className="w-full text-sm text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}

function ReplyForm({
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
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={NICKNAME_MAX}
            placeholder={`닉네임 (최대 ${NICKNAME_MAX}자)`}
            required
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm sm:w-40"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={PW_MIN}
            maxLength={PW_MAX}
            placeholder={`비밀번호 (${PW_MIN}~${PW_MAX}자)`}
            required
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm sm:w-52"
          />
        </div>
      )}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={CONTENT_MAX}
        placeholder="답글을 입력해주세요"
        required
        rows={2}
        autoFocus
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-700"
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

function EditRow({
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
        maxLength={CONTENT_MAX}
        rows={3}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        {requiresPassword && (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
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
          className="text-sm text-zinc-500"
        >
          취소
        </button>
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
