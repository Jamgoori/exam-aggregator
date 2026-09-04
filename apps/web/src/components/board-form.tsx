"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RichTextEditor } from "@/components/rich-text-editor";
import { createBoardPost, updateBoardPost } from "@/app/board/actions";
import { BOARD_CATEGORIES, BOARD_TITLE_MAX } from "@gongmoa/core";

// 글쓰기·수정 공용 폼. 두 화면이 다른 것은 "처음 값이 있는가"와 부르는 액션뿐이라
// 폼을 둘로 나누지 않는다(나누면 에디터 설정이 두 곳에서 어긋난다).
export function BoardForm({
  mode,
  postId,
  isAdmin = false,
  initial,
}: {
  mode: "create" | "edit";
  postId?: string;
  isAdmin?: boolean;
  initial?: {
    title: string;
    category: string;
    contentHtml: string;
    isPinned: boolean;
  };
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "free");
  // 에디터가 만드는 HTML. 상태로 들고 있되 에디터에 되돌려 넣지는 않는다
  // (제어 컴포넌트로 만들면 타이핑마다 커서가 튄다 — rich-text-editor.tsx 참고).
  const [contentHtml, setContentHtml] = useState(initial?.contentHtml ?? "");
  const [isPinned, setIsPinned] = useState(initial?.isPinned ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result =
        mode === "edit" && postId
          ? await updateBoardPost({ id: postId, title, category, contentHtml, isPinned })
          : await createBoardPost({ title, category, contentHtml, isPinned });

      if (result.error) {
        setError(result.error);
        return;
      }
      // 등록·수정 뒤에는 쓴 글로 곧장 보낸다 — 목록으로 보내면 "내 글이 올라갔나"를
      // 눈으로 찾게 만든다.
      router.push(`/board/${result.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="말머리"
          className="rounded-xl border border-zinc-300 px-3 py-2.5 text-sm font-medium sm:w-36 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {BOARD_CATEGORIES.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.label}
            </option>
          ))}
        </select>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목을 입력하세요"
          maxLength={BOARD_TITLE_MAX}
          required
          aria-label="제목"
          className="min-w-0 flex-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </div>

      <RichTextEditor
        initialHtml={initial?.contentHtml ?? ""}
        onChange={setContentHtml}
        placeholder="자유롭게 이야기를 남겨주세요. 사진도 넣을 수 있어요."
      />

      {isAdmin && (
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={isPinned}
            onChange={(e) => setIsPinned(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          목록 맨 위에 고정 (공지)
        </label>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Link
          href={mode === "edit" && postId ? `/board/${postId}` : "/board"}
          className="rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          취소
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "올리는 중…" : mode === "edit" ? "수정하기" : "등록하기"}
        </button>
      </div>

      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
        욕설·비방·개인정보가 담긴 글은 예고 없이 삭제될 수 있어요.
      </p>
    </form>
  );
}
