"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

// 자유게시판 검색창.
//
// 입력할 때마다 서버를 왕복하지 않는다(디바운스도 없다) — 제출했을 때만 주소를
// 바꾼다. 게시판 검색은 "생각하고 한 번 누르는" 동작이라, 글자마다 목록이
// 흔들리면 오히려 읽기 어렵다.
export function BoardSearch({
  initialQuery,
  category,
}: {
  initialQuery: string;
  category?: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  function go(query: string) {
    const usp = new URLSearchParams();
    if (category) usp.set("category", category);
    if (query.trim()) usp.set("q", query.trim());
    const qs = usp.toString();
    router.push(qs ? `/board?${qs}` : "/board");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go(value);
      }}
      className="relative flex-1 sm:max-w-xs"
    >
      <Search
        size={16}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400"
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="제목·내용 검색"
        aria-label="게시글 검색"
        className="w-full rounded-xl border border-zinc-300 py-2.5 pr-9 pl-9 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            go("");
          }}
          aria-label="검색어 지우기"
          className="absolute top-1/2 right-2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
        >
          <X size={14} />
        </button>
      )}
    </form>
  );
}
