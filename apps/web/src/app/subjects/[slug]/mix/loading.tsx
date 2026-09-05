// 기출 섞어풀기 시작 화면 스켈레톤 — 실제 화면(헤더 → 시작 패널 → 안내 → 기록)과 같은 뼈대.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function MixPracticeLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-12 pt-6 sm:pt-8">
      <div className="flex flex-col gap-3">
        <Block className="h-4 w-32" />
        <Block className="h-5 w-16 rounded" />
        <Block className="h-8 w-64" />
        <Block className="h-4 w-full max-w-md" />
      </div>
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
        <Block className="h-3 w-12" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Block key={i} className="h-9 w-20 rounded-full" />
          ))}
        </div>
        <Block className="h-11 w-full rounded-xl" />
      </div>
      <div className="flex flex-col gap-2">
        <Block className="h-4 w-full" />
        <Block className="h-4 w-11/12" />
        <Block className="h-4 w-10/12" />
      </div>
    </div>
  );
}
