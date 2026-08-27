import type { CSSProperties } from "react";

function Block({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={`skeleton rounded-lg ${className}`}
      style={{ "--skeleton-delay": `${delay}s` } as CSSProperties}
    />
  );
}

export default function NoticesLoading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <div className="flex flex-col gap-2">
        <Block className="h-8 w-40" />
        <Block className="h-4 w-full max-w-md" delay={0.05} />
      </div>

      <div className="flex items-center justify-between">
        <Block className="h-4 w-20" delay={0.1} />
        <Block className="h-9 w-28" delay={0.1} />
      </div>

      <div className="flex flex-col gap-px overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
        {Array.from({ length: 8 }).map((_, i) => (
          <Block key={i} className="h-12 rounded-none" delay={0.15 + i * 0.05} />
        ))}
      </div>
    </div>
  );
}
