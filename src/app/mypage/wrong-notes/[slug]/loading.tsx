// 과목 오답노트는 응시 이력 전체를 집계하느라 첫 로딩이 느릴 수 있어서,
// 실제 페이지와 같은 뼈대(헤더 → 문제지 카드 목록)를 미리 깔아둔다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

function PaperCardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex items-center gap-2">
        <Block className="h-5 w-10 rounded" />
        <Block className="h-5 w-56" />
      </div>
      <div className="flex items-center gap-3">
        <Block className="h-4 w-14 rounded-full" />
        <Block className="h-4 w-24" />
        <Block className="h-4 w-28" />
      </div>
    </div>
  );
}

export default function SubjectWrongNoteLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <Block className="h-4 w-24" />
        <Block className="h-5 w-16 rounded" />
        <Block className="h-8 w-56" />
        <Block className="h-4 w-full max-w-md" />
      </div>
      <div className="flex flex-col gap-3">
        <PaperCardSkeleton />
        <PaperCardSkeleton />
        <PaperCardSkeleton />
      </div>
    </div>
  );
}
