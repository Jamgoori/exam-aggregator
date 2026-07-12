// 전체 해설 페이지는 문항 이미지·정답·해설을 한 번에 모아오느라 첫 로딩이 느릴 수
// 있어서, 실제 페이지(헤더 → 문제 카드 + 펼쳐진 해설)와 같은 뼈대를 미리 깔아둔다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

function ExplanationCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-800/50">
        <Block className="h-4 w-12" />
      </div>
      <Block className="h-48 w-full rounded-none" />
      <div className="flex items-center gap-1.5 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
        {Array.from({ length: 4 }, (_, i) => (
          <Block key={i} className="h-9 w-9 rounded-full" />
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <Block className="h-4 w-20" />
        <Block className="h-20 w-full" />
      </div>
    </div>
  );
}

export default function PaperExplanationsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <Block className="h-4 w-20" />
        <div className="flex gap-2">
          <Block className="h-5 w-10 rounded" />
          <Block className="h-5 w-14 rounded" />
          <Block className="h-5 w-14 rounded" />
        </div>
        <Block className="h-8 w-full max-w-md" />
        <Block className="h-4 w-32" />
      </div>
      <div className="flex flex-col gap-4">
        <ExplanationCardSkeleton />
        <ExplanationCardSkeleton />
      </div>
    </div>
  );
}
