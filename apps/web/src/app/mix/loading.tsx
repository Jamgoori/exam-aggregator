// 섞어풀기 허브 스켈레톤 — 실제 화면(제목 → 최근 기록 → 과목 카드)과 같은 뼈대.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function MixHubLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-12 pt-6 sm:pt-8">
      <div className="flex flex-col gap-2">
        <Block className="h-8 w-48" />
        <Block className="h-4 w-full max-w-lg" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Block key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
