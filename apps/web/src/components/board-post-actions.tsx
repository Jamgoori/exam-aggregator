"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart, Link2, Trash2 } from "lucide-react";
import { deleteBoardPost, toggleBoardLike } from "@/app/board/actions";

// 글 하단의 좋아요·공유 줄. 좋아요는 누른 즉시 숫자가 바뀌고(낙관적 반영),
// 서버가 거절하면 되돌린다 — 왕복을 기다리게 하면 "눌렸나?" 하고 두 번 누른다.
export function BoardLikeButton({
  postId,
  initialLiked,
  initialCount,
  loggedIn,
}: {
  postId: string;
  initialLiked: boolean;
  initialCount: number;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle() {
    if (!loggedIn) {
      setError("로그인 후 이용할 수 있어요.");
      return;
    }
    setError(null);
    const nextLiked = !liked;
    setLiked(nextLiked);
    setCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));

    startTransition(async () => {
      const result = await toggleBoardLike(postId);
      if (result.error) {
        setLiked(!nextLiked);
        setCount((c) => Math.max(0, c + (nextLiked ? -1 : 1)));
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={liked}
        className={`flex items-center gap-1.5 rounded-full border px-5 py-2.5 text-sm font-bold transition-colors ${
          liked
            ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400"
            : "border-zinc-200 text-zinc-500 hover:border-rose-200 hover:text-rose-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-rose-900"
        }`}
      >
        <Heart size={16} fill={liked ? "currentColor" : "none"} />
        좋아요 {count}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function BoardShareButton() {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // 클립보드 권한이 없는 브라우저(구형 인앱 브라우저 등)에서는 조용히 넘긴다 —
          // 주소창이 이미 같은 주소를 들고 있어서 사용자가 직접 복사할 수 있다.
        }
      }}
      className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:text-blue-400"
    >
      <Link2 size={13} />
      {copied ? "주소 복사됨" : "공유"}
    </button>
  );
}

export function BoardDeleteButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("이 글을 삭제할까요? 되돌릴 수 없어요.")) return;
          startTransition(async () => {
            const result = await deleteBoardPost(postId);
            if (result.error) {
              setError(result.error);
              return;
            }
            router.push("/board");
            router.refresh();
          });
        }}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-red-900 dark:hover:text-red-400"
      >
        <Trash2 size={13} />
        {pending ? "삭제 중…" : "삭제"}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </>
  );
}
