// 과목 오답노트는 응시 이력 전체를 집계하고 문항 이미지까지 붙여오느라 첫 로딩이
// 느릴 수 있어서, 실제 페이지와 같은 뼈대(헤더 → 필터 알약 → 문제 카드)를 미리 깔아둔다.
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

export default function SubjectWrongNoteLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <Block className="h-4 w-24" />
        <Block className="h-5 w-16 rounded" />
        <Block className="h-8 w-56" />
        <Block className="h-4 w-full max-w-md" />
      </div>
      <div className="flex gap-2">
        <Block className="h-8 w-24 rounded-full" />
        <Block className="h-8 w-40 rounded-full" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Block className="h-5 w-10 rounded" />
          <Block className="h-4 w-64" />
        </div>
        <QuestionCardSkeleton />
        <QuestionCardSkeleton />
      </div>
    </div>
  );
}
