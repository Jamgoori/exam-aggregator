"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Bookmark } from "lucide-react";
import { toggleBookmark } from "@/app/papers/actions";

export function BookmarkButton({
  paperId,
  initialBookmarked,
  loggedIn,
  size = "md",
}: {
  paperId: string;
  initialBookmarked: boolean;
  loggedIn: boolean;
  // 목록 카드처럼 좁은 자리에 넣을 때는 "sm"으로 줄인다.
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    if (!loggedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await toggleBookmark(paperId);
      if (result.error) {
        setError(result.error);
      } else {
        setBookmarked(result.bookmarked ?? !bookmarked);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label={bookmarked ? "즐겨찾기 해제" : "즐겨찾기 추가"}
      title={
        error ?? (loggedIn ? undefined : "로그인 후 이용할 수 있어요")
      }
      className={`flex shrink-0 items-center justify-center rounded-full border disabled:opacity-50 ${
        size === "sm" ? "p-1.5" : "p-2.5"
      } ${
        bookmarked
          ? "border-amber-300 bg-amber-50 text-amber-500"
          : "border-zinc-300 text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
      }`}
    >
      <Bookmark size={size === "sm" ? 14 : 18} fill={bookmarked ? "currentColor" : "none"} />
    </button>
  );
}
