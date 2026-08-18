"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { postComment } from "@/app/papers/actions";
import { CommentRow } from "@/components/comment-row";
import { EditRow } from "@/components/comment-edit-row";
import { ReplyForm } from "@/components/comment-reply-form";
import { buildCommentTree, canReplyTo, COMMENT_CONTENT_MAX } from "@gongmoa/core";
import type { Comment, CommentNode } from "@gongmoa/core";

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
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 작성 폼 상태
  const [content, setContent] = useState("");

  // 편집/답글 작성 중인 댓글
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);

  // 답글에 답글을 달 수 있어 깊이가 여러 단이므로 트리로 만들어 재귀로 그린다
  // (규칙·깊이 한도는 @gongmoa/core 에 있어 앱과 같다).
  const tree = buildCommentTree(comments);

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await postComment({ paperId, content });
      if (result.error) {
        setError(result.error);
      } else {
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

  // 한 댓글과 그 아래 답글들을 재귀로 그린다. 답글 폼은 깊이 한도에 닿지 않은
  // 댓글에만 붙는다(서버도 같은 한도로 거절한다).
  function renderNode(node: CommentNode) {
    const replyable = loggedIn && canReplyTo(node.depth);
    return (
      <>
        {renderRow(node, {
          canReply: replyable,
          isReplying: replyingToId === node.id,
        })}

        {node.replies.length > 0 && (
          <div className="mt-4 ml-6 flex flex-col gap-4 border-l-2 border-zinc-100 pl-4 dark:border-zinc-700">
            {node.replies.map((reply) => (
              <div key={reply.id}>{renderNode(reply)}</div>
            ))}
          </div>
        )}

        {replyingToId === node.id && (
          <div className="mt-4 ml-6 border-l-2 border-zinc-100 pl-4 dark:border-zinc-700">
            <ReplyForm
              paperId={paperId}
              parentId={node.id}
              onDone={() => {
                setReplyingToId(null);
                router.refresh();
              }}
              onCancel={() => setReplyingToId(null)}
            />
          </div>
        )}
      </>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-lg font-semibold">댓글 {comments.length}개</h2>

      {/* 댓글은 로그인한 사람만 — 비회원 작성 경로는 서버 액션에서도 막혀 있다. */}
      {!loggedIn ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-200 px-4 py-6 dark:border-zinc-700">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            댓글은 로그인 후 남길 수 있어요
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(pathname || "/")}`}
            className="rounded bg-zinc-800 px-4 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-700 dark:hover:bg-zinc-600"
          >
            로그인하기
          </Link>
        </div>
      ) : (
        <form onSubmit={submitNew} className="flex flex-col gap-3">
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
      )}

      <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-700">
        {tree.length === 0 && (
          <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-500">
            아직 댓글이 없어요. 첫 댓글을 남겨보세요.
          </p>
        )}
        {tree.map((node) => (
          <div key={node.id} className="py-5">
            {renderNode(node)}
          </div>
        ))}
      </div>
    </section>
  );
}
