// 기출문제 검색 페이지(/papers) 스켈레톤: 제목 → 검색창 → 과목 탭 → 문제지 카드
// 그리드 순서로, exam-browser.tsx가 그리는 실제 구도와 같은 자리를 잡아둔다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

function ExamCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Block className="h-5 w-10 rounded" />
          <Block className="h-5 w-14 rounded" />
        </div>
        <Block className="h-7 w-7 shrink-0 rounded-full" />
      </div>
      <Block className="h-4 w-full" />
      <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-700">
        <Block className="h-5 w-16 rounded-full" />
        <Block className="h-4 w-16" />
      </div>
    </div>
  );
}

export default function PapersLoading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <div className="flex flex-col items-start gap-3">
        <Block className="h-6 w-40 rounded-full" />
        <Block className="h-10 w-72 sm:h-11 sm:w-96" />
        <Block className="h-10 w-56 sm:h-11 sm:w-72" />
        <Block className="h-4 w-full max-w-md" />
      </div>

      <Block className="h-12 w-full rounded-xl" />

      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Block key={i} className="h-8 w-16 rounded-full" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <ExamCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
