"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Star } from "lucide-react";
import { toggleSubjectBookmark } from "@/app/subjects/actions";

export function SubjectBookmarkButton({
  subjectId,
  initialBookmarked,
  loggedIn,
  size = "md",
}: {
  subjectId: string;
  initialBookmarked: boolean;
  loggedIn: boolean;
  // 과목 인덱스 모달처럼 좁은 자리에 넣을 때는 "sm"으로 줄인다.
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!loggedIn) {
      router.push(`/login?next=${encodeURIComponent(pathname || "/")}`);
      return;
    }
    setError(null);
    // 서버 응답을 기다리지 않고 즉시 아이콘부터 바꾼다(낙관적 업데이트). 실패하면
    // 원래 상태로 되돌린다.
    const next = !bookmarked;
    setBookmarked(next);
    startTransition(async () => {
      const result = await toggleSubjectBookmark(subjectId);
      if (result.error) {
        setError(result.error);
        setBookmarked(!next);
      } else if (typeof result.bookmarked === "boolean") {
        setBookmarked(result.bookmarked);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label={bookmarked ? "과목 즐겨찾기 해제" : "과목 즐겨찾기 추가"}
      title={
        error ?? (loggedIn ? undefined : "로그인 후 이용할 수 있어요")
      }
      className={`flex shrink-0 items-center justify-center rounded-full border disabled:opacity-50 ${
        size === "sm" ? "p-1.5" : "p-2.5"
      } ${
        bookmarked
          ? "border-amber-300 bg-amber-50 text-amber-500 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
          : "border-zinc-300 text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:bg-blue-950/40 dark:hover:text-blue-400"
      }`}
    >
      <Star size={size === "sm" ? 14 : 18} fill={bookmarked ? "currentColor" : "none"} />
    </button>
  );
}
