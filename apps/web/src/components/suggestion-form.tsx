"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { createSuggestion, updateSuggestion } from "@/app/suggestions/actions";
import { SUGGESTION_CONTENT_MAX, SUGGESTION_TITLE_MAX } from "@gongmoa/core";

// 건의 작성/수정 폼. 새 글과 수정이 같은 컴포넌트인 이유는 입력 항목이 완전히
// 같아서다 — 따로 두면 "수정 화면에만 비밀글 체크박스가 빠진" 식으로 갈라진다.
export function SuggestionForm({
  suggestion,
}: {
  suggestion?: {
    id: string;
    title: string;
    content: string;
    isSecret: boolean;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(suggestion?.title ?? "");
  const [content, setContent] = useState(suggestion?.content ?? "");
  const [isSecret, setIsSecret] = useState(suggestion?.isSecret ?? false);

  const editing = suggestion !== undefined;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateSuggestion({ id: suggestion.id, title, content, isSecret })
        : await createSuggestion({ title, content, isSecret });

      if (result.error) {
        setError(result.error);
        return;
      }
      // 등록/수정한 글을 바로 보여준다. router.refresh()는 목록으로 돌아갔을 때
      // 캐시된 이전 목록이 잠깐 보이는 것을 막는다.
      router.replace(`/suggestions/${result.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="suggestion-title" className="text-sm font-medium">
          제목
        </label>
        <input
          id="suggestion-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={SUGGESTION_TITLE_MAX}
          placeholder="예) 오답노트에 과목별 필터가 있으면 좋겠어요"
          required
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="suggestion-content" className="text-sm font-medium">
          내용
        </label>
        <textarea
          id="suggestion-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={SUGGESTION_CONTENT_MAX}
          placeholder="어떤 점이 불편했는지, 무엇이 있으면 좋을지 편하게 적어주세요."
          required
          rows={10}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <p className="self-end text-xs text-zinc-400 dark:text-zinc-500">
          {content.length}/{SUGGESTION_CONTENT_MAX}
        </p>
      </div>

      {/* 비밀글 — 이 게시판의 핵심 옵션이라 체크박스를 눈에 띄는 카드로 둔다. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 px-3.5 py-3 transition-colors hover:border-blue-300 has-checked:border-blue-400 has-checked:bg-blue-50/60 dark:border-zinc-700 dark:hover:border-blue-800 dark:has-checked:border-blue-800 dark:has-checked:bg-blue-950/25">
        <input
          type="checkbox"
          checked={isSecret}
          onChange={(e) => setIsSecret(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Lock size={14} className="shrink-0 text-blue-600 dark:text-blue-400" />
            비밀글로 작성
          </span>
          <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
            체크하면 제목과 내용을 나와 운영자만 볼 수 있어요. 결제·계정처럼 남에게
            보이면 곤란한 내용은 비밀글로 남겨주세요.
          </span>
        </span>
      </label>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Link
          href={editing ? `/suggestions/${suggestion.id}` : "/suggestions"}
          className="rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "저장 중..." : editing ? "수정하기" : "등록하기"}
        </button>
      </div>
    </form>
  );
}
