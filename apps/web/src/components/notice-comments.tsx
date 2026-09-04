"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createNoticeComment,
  deleteNoticeComment,
  updateNoticeComment,
} from "@/app/notices/actions";
import { NOTICE_COMMENT_MAX, KST_TIME_ZONE } from "@gongmoa/core";
import type { NoticeCommentItem } from "@/lib/notices";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 공지 상세 화면의 댓글 영역. 답글 트리 없이 평평한 목록이다 — 로그인 회원만
// 쓸 수 있고 공지 하나에 딸린 짧은 의견들이라, 문제지 댓글(comments-section.tsx)의
// 답글·비회원 비밀번호 같은 복잡함이 필요 없다(suggestion-comments.tsx와 같음).
//
// 원글(제목·내용)은 관리자만 쓸 수 있지만 댓글은 반대로 로그인 회원이면 누구나
// 달 수 있다 — loggedIn만 확인하면 되고 별도 admin 분기는 없다.
export function NoticeComments({
  noticeId,
  comments,
  loggedIn,
}: {
  noticeId: string;
  comments: NoticeCommentItem[];
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createNoticeComment({ noticeId, content });
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
      <h2 className="text-base font-semibold">댓글 {comments.length}개</h2>

      {loggedIn ? (
        <form onSubmit={submitNew} className="flex flex-col gap-2">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={NOTICE_COMMENT_MAX}
            placeholder="댓글을 남겨주세요"
            required
            rows={3}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="self-end rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? "등록 중..." : "댓글 등록"}
          </button>
        </form>
      ) : (
        <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400">
          로그인 후 댓글을 남길 수 있어요.
        </p>
      )}

      <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
        {comments.length === 0 && (
          <li className="py-6 text-center text-sm text-zinc-400 dark:text-zinc-500">
            아직 댓글이 없어요.
          </li>
        )}

        {comments.map((c) =>
          editingId === c.id ? (
            <li key={c.id} className="py-3">
              <EditCommentRow
                comment={c}
                onDone={() => {
                  setEditingId(null);
                  router.refresh();
                }}
                onCancel={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li key={c.id} className="flex flex-col gap-1 py-3">
              <div className="flex items-center gap-2 text-xs text-zinc-400 dark:text-zinc-500">
                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                  {c.nickname}
                </span>
                <span>{formatDateTime(c.createdAt)}</span>
                {c.updatedAt && <span>(수정됨)</span>}
              </div>
              <p className="text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
                {c.content}
              </p>
              {(c.canEdit || c.canDelete) && (
                <div className="mt-0.5 flex gap-3">
                  {c.canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditingId(c.id)}
                      className="text-xs text-zinc-400 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
                    >
                      수정
                    </button>
                  )}
                  {c.canDelete && (
                    <DeleteCommentButton
                      commentId={c.id}
                      onDeleted={() => router.refresh()}
                    />
                  )}
                </div>
              )}
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function EditCommentRow({
  comment,
  onDone,
  onCancel,
}: {
  comment: NoticeCommentItem;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [content, setContent] = useState(comment.content);
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateNoticeComment({ commentId: comment.id, content });
      if (result.error) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={NOTICE_COMMENT_MAX}
        rows={3}
        className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "저장 중..." : "저장"}
        </button>
      </div>
    </form>
  );
}

function DeleteCommentButton({
  commentId,
  onDeleted,
}: {
  commentId: string;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function onDelete() {
    if (!confirm("댓글을 삭제할까요?")) return;
    startTransition(async () => {
      const result = await deleteNoticeComment(commentId);
      if (!result.error) onDeleted();
    });
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={pending}
      className="text-xs text-zinc-400 hover:text-red-600 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-red-400"
    >
      삭제
    </button>
  );
}
