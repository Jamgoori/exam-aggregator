// 약점 진단 스켈레톤: 제목 → 요약 한 줄 → 지금 할 일 → 기간 탭 → 과목별 개념 행.
// 본문과 같은 골격이라 로딩이 끝나도 레이아웃이 튀지 않는다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded ${className}`} />;
}

// 접힌 개념 행 하나(이름 + 문항 수 + 막대).
function Row() {
  return (
    <div className="flex flex-col gap-1.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <Block className="h-3.5 w-44" />
        <Block className="h-3.5 w-12" />
      </div>
      <Block className="h-1.5 w-full rounded-sm" />
    </div>
  );
}

export default function DiagnosisLoading() {
  return (
    <div className="min-h-dvh bg-white dark:bg-zinc-950">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-5 pb-20 pt-6 sm:pt-10">
        <div className="flex flex-col gap-3">
          <Block className="h-4 w-24" />
          <Block className="h-7 w-40" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Block className="h-4 w-full" />
          <Block className="h-4 w-3/5" />
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-zinc-800">
          <Block className="h-3 w-32" />
          <Block className="h-4 w-52" />
          <Block className="h-9 w-full rounded-lg" />
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex gap-5 border-b border-slate-200 pb-2 dark:border-zinc-800">
            <Block className="h-4 w-24" />
            <Block className="h-4 w-16" />
            <Block className="h-4 w-10" />
          </div>

          {Array.from({ length: 2 }, (_, s) => (
            <div key={s}>
              <div className="flex items-center justify-between gap-2 border-b border-slate-300 pb-1.5 dark:border-zinc-700">
                <Block className="h-4 w-20" />
                <Block className="h-3 w-28" />
              </div>
              <div className="flex flex-col divide-y divide-slate-200 dark:divide-zinc-800">
                {Array.from({ length: 3 }, (_, i) => (
                  <Row key={i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
