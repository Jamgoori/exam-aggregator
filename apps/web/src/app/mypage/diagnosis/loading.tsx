// AI 약점 진단 대시보드 스켈레톤: 제목 → 히어로 미션 → 취약 개념 카드 3장 → 추이 자리.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function DiagnosisLoading() {
  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-zinc-950">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 pt-6 sm:pt-8">
        <div className="flex flex-col gap-2">
          <Block className="h-4 w-24" />
          <Block className="h-8 w-56" />
          <Block className="h-4 w-32" />
        </div>
        <Block className="h-40 w-full rounded-2xl" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex gap-2">
                <Block className="h-6 w-24 rounded-full" />
                <Block className="h-6 w-20 rounded-full" />
              </div>
              <Block className="h-5 w-40" />
              <div className="flex gap-2">
                <Block className="h-9 flex-1 rounded-lg" />
                <Block className="h-9 flex-1 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
