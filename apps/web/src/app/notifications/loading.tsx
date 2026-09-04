import type { CSSProperties } from "react";

// 알림함 스켈레톤. 내 알림만 보여주는 화면이라(세션 의존) 정적으로 미리 그릴 수
// 없다 — 그동안 목록 구도를 깔아둔다.
function Block({ className = "", delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div
      className={`skeleton rounded-lg ${className}`}
      style={{ "--skeleton-delay": `${delay}s` } as CSSProperties}
    />
  );
}

export default function NotificationsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <div className="flex items-center gap-2">
        <Block className="h-9 w-9 rounded-xl" />
        <div className="flex flex-col gap-1.5">
          <Block className="h-6 w-24" delay={0.05} />
          <Block className="h-3 w-32" delay={0.08} />
        </div>
      </div>

      <div className="flex flex-col gap-px overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
        {Array.from({ length: 6 }).map((_, i) => (
          <Block key={i} className="h-20 rounded-none" delay={0.1 + i * 0.05} />
        ))}
      </div>
    </div>
  );
}
