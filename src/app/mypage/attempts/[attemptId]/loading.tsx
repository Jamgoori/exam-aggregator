// 회차 오답노트도 문항 이미지 조회가 껴 있어 첫 진입이 느릴 수 있으므로,
// 실제 페이지(헤더 → 점수/오답 통계 → 문제 카드)와 같은 모양의 스켈레톤을 깔아둔다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

function QuestionCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200">
      <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2.5">
        <Block className="h-4 w-12" />
      </div>
      <Block className="h-48 w-full rounded-none" />
      <div className="flex items-center gap-1.5 border-t border-zinc-100 px-4 py-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Block key={i} className="h-9 w-9 rounded-full" />
        ))}
      </div>
    </div>
  );
}

export default function AttemptWrongNoteLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <Block className="h-4 w-28" />
        <div className="flex gap-2">
          <Block className="h-5 w-10 rounded" />
          <Block className="h-5 w-14 rounded" />
          <Block className="h-5 w-14 rounded-full" />
        </div>
        <Block className="h-8 w-full max-w-md" />
        <Block className="h-4 w-48" />
      </div>
      <div className="flex gap-3">
        <Block className="h-20 flex-1 rounded-xl" />
        <Block className="h-20 flex-1 rounded-xl" />
      </div>
      <div className="flex flex-col gap-4">
        <Block className="h-6 w-48" />
        <QuestionCardSkeleton />
        <QuestionCardSkeleton />
      </div>
    </div>
  );
}
