import type { CSSProperties } from "react";

// 자유게시판 목록 스켈레톤. 목록은 검색어·말머리(searchParams)에 따라 달라져
// 정적으로 미리 그릴 수 없다 — 그동안 빈 화면 대신 카드 구도를 깔아둔다.
function Block({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={`skeleton rounded-lg ${className}`}
      style={{ "--skeleton-delay": `${delay}s` } as CSSProperties}
    />
  );
}

export default function BoardLoading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pt-6 pb-12 sm:pt-8">
      <div className="flex flex-col gap-2">
        <Block className="h-8 w-36" />
        <Block className="h-4 w-full max-w-lg" delay={0.05} />
      </div>

      <div className="flex gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Block key={i} className="h-8 w-16 rounded-full" delay={0.08 + i * 0.03} />
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Block className="h-10 w-full sm:max-w-xs" delay={0.12} />
        <Block className="h-10 w-24" delay={0.12} />
      </div>

      <div className="flex flex-col gap-px overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
        {Array.from({ length: 6 }).map((_, i) => (
          <Block key={i} className="h-24 rounded-none" delay={0.15 + i * 0.05} />
        ))}
      </div>
    </div>
  );
}
