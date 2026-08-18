import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Lock, Pin } from "lucide-react";
import { SuggestionAnswerForm } from "@/components/suggestion-answer-form";
import { SuggestionComments } from "@/components/suggestion-comments";
import { SuggestionDeleteButton } from "@/components/suggestion-delete-button";
import {
  countSuggestionView,
  fetchSuggestion,
  fetchSuggestionComments,
  getSuggestionViewer,
} from "@/lib/suggestions";

export const metadata: Metadata = {
  title: "건의게시판",
  robots: { index: false, follow: false },
};

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function SuggestionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getSuggestionViewer();
  const result = await fetchSuggestion(id, viewer);

  if (result.status === "not_found") notFound();

  // 비밀글은 "없는 글"처럼 감추지 않고 잠긴 안내를 보여준다 — 목록에 자리는 이미
  // 보이므로, 404 로 돌려보내면 오히려 무슨 일인지 알 수 없다.
  if (result.status === "forbidden") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 py-24 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
          <Lock size={22} />
        </span>
        <h1 className="text-lg font-bold">비밀글이에요</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {viewer.loggedIn
            ? "이 글은 작성자와 운영자만 볼 수 있어요."
            : "이 글은 작성자와 운영자만 볼 수 있어요. 본인 글이라면 로그인 후 다시 확인해주세요."}
        </p>
        <div className="flex gap-2">
          {!viewer.loggedIn && (
            <Link
              href={`/login?next=${encodeURIComponent(`/suggestions/${id}`)}`}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              로그인
            </Link>
          )}
          <Link
            href="/suggestions"
            className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            목록으로
          </Link>
        </div>
      </div>
    );
  }

  const { suggestion } = result;
  const [, comments] = await Promise.all([
    countSuggestionView(suggestion.id, viewer, suggestion.authorId),
    fetchSuggestionComments(suggestion.id, viewer),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <Link
        href="/suggestions"
        className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
      >
        ← 건의게시판
      </Link>

      <article className="flex flex-col gap-4">
        <header className="flex flex-col gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-700">
          <div className="flex flex-wrap items-center gap-2">
            {suggestion.isPinned && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                <Pin size={11} />
                공지
              </span>
            )}
            {suggestion.isSecret && (
              <span className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <Lock size={11} />
                비밀글
              </span>
            )}
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                suggestion.answer
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {suggestion.answer ? "답변완료" : "답변 대기"}
            </span>
          </div>

          <h1 className="text-xl font-bold break-words">{suggestion.title}</h1>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400 dark:text-zinc-500">
            <span>{suggestion.nickname}</span>
            <span>{formatDateTime(suggestion.createdAt)}</span>
            {suggestion.updatedAt && <span>(수정됨)</span>}
            <span>조회 {suggestion.viewCount}</span>
          </div>
        </header>

        <p className="min-h-24 text-sm leading-7 whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
          {suggestion.content}
        </p>

        {(suggestion.canEdit || suggestion.canDelete) && (
          <div className="flex items-center justify-end gap-2">
            {suggestion.canEdit && (
              <Link
                href={`/suggestions/${suggestion.id}/edit`}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:text-blue-400"
              >
                수정
              </Link>
            )}
            {suggestion.canDelete && <SuggestionDeleteButton id={suggestion.id} />}
          </div>
        )}
      </article>

      {suggestion.answer && (
        <section className="flex flex-col gap-2 rounded-xl border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">
              운영자 답변
            </span>
            {suggestion.answeredAt && (
              <span className="text-xs text-zinc-400 dark:text-zinc-500">
                {formatDateTime(suggestion.answeredAt)}
              </span>
            )}
          </div>
          <p className="text-sm leading-7 whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
            {suggestion.answer}
          </p>
        </section>
      )}

      {viewer.isAdmin && (
        <SuggestionAnswerForm
          suggestionId={suggestion.id}
          initialAnswer={suggestion.answer}
        />
      )}

      <div className="border-t border-zinc-200 pt-6 dark:border-zinc-700">
        <SuggestionComments
          suggestionId={suggestion.id}
          comments={comments}
          loggedIn={viewer.loggedIn}
        />
      </div>
    </div>
  );
}
