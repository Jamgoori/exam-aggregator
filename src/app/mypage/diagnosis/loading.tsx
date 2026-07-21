// AI 약점 진단 리포트 스켈레톤: 제목 → 요약 카드 → 과목별 추이 목록 자리.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function DiagnosisLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <Block className="h-4 w-24" />
        <Block className="h-8 w-56" />
        <Block className="h-4 w-32" />
      </div>
      <Block className="h-28 w-full rounded-xl" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
          >
            <Block className="h-5 w-14 rounded" />
            <Block className="h-4 flex-1" />
            <Block className="h-5 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
