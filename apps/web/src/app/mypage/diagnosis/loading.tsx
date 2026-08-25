// AI 약점 진단 스켈레톤: 제목 → 기간 탭 → 막대그래프 자리 → 개념 목록 3줄.
// 본문과 같은 골격(테두리 없는 목록, 얇은 막대)이라 로딩이 끝나도 화면이 튀지 않는다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />;
}

export default function DiagnosisLoading() {
  return (
    <div className="min-h-dvh bg-white dark:bg-zinc-950">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-20 pt-6 sm:pt-10">
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 dark:border-zinc-800">
          <Block className="h-4 w-24" />
          <Block className="h-7 w-40" />
          <Block className="h-4 w-56" />
        </div>

        <div className="flex flex-col gap-4">
          <Block className="h-5 w-48" />
          <div className="flex gap-5 border-b border-slate-200 pb-2 dark:border-zinc-800">
            <Block className="h-4 w-24" />
            <Block className="h-4 w-16" />
            <Block className="h-4 w-10" />
          </div>
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Block className="h-3.5 w-40" />
                <Block className="h-1.5 w-full rounded-sm" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col divide-y divide-slate-200 border-y border-slate-200 dark:divide-zinc-800 dark:border-zinc-800">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 py-5">
              <Block className="h-3 w-16" />
              <Block className="h-4 w-52" />
              <Block className="h-3 w-64" />
              <Block className="mt-1.5 h-9 w-44 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
