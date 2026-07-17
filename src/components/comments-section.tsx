"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postComment } from "@/app/papers/actions";
import { CommentRow } from "@/components/comment-row";
import { EditRow } from "@/components/comment-edit-row";
import { ReplyForm } from "@/components/comment-reply-form";
import { CommentGuestFields } from "@/components/comment-guest-fields";
import { COMMENT_CONTENT_MAX } from "@/lib/comment-constraints";
import type { Comment } from "@/lib/supabase/types";

// 댓글 영역 전체의 오케스트레이터: 새 댓글 폼 + 댓글/답글 목록을 그리고,
// 어떤 댓글이 편집 중인지/어디에 답글을 다는 중인지 상태를 관리한다.
// 개별 줄의 표시·수정·삭제·답글 UI는 각각 CommentRow/EditRow/ReplyForm 담당.
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
          placeholder="이 시험에 대한 의견을 남겨주세요"
          required
          rows={3}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
        />
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="self-end rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "등록 중..." : "댓글 등록"}
        </button>
      </form>

      <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-700">
        {topLevelComments.length === 0 && (
          <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-500">
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
                <div className="mt-4 ml-6 flex flex-col gap-4 border-l-2 border-zinc-100 pl-4 dark:border-zinc-700">
                  {replies.map((reply) => (
                    <div key={reply.id}>
                      {renderRow(reply, { canReply: false, isReplying: false })}
                    </div>
                  ))}
                </div>
              )}

              {replyingToId === comment.id && (
                <div className="mt-4 ml-6 border-l-2 border-zinc-100 pl-4 dark:border-zinc-700">
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
