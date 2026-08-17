"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSuggestion } from "@/app/suggestions/actions";

// 상세 화면의 삭제 버튼. 되돌릴 수 없는 동작이라 한 번 확인을 받는다.
export function SuggestionDeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    if (!confirm("이 글을 삭제할까요? 삭제하면 되돌릴 수 없어요.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteSuggestion(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.replace("/suggestions");
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-red-800 dark:hover:text-red-400"
      >
        {pending ? "삭제 중..." : "삭제"}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </>
  );
}
