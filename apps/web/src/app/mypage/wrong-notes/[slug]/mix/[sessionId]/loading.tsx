// 섞어풀기 기록 페이지 스켈레톤 — 실제 화면(헤더 → 점수 요약 → 버튼 → 문항 카드)과 같은 뼈대.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function MixSessionWrongNoteLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-12 pt-6 sm:pt-8">
      <div className="flex flex-col gap-3">
        <Block className="h-4 w-28" />
        <div className="flex gap-2">
          <Block className="h-5 w-12 rounded" />
          <Block className="h-5 w-20 rounded" />
        </div>
        <Block className="h-8 w-52" />
        <Block className="h-3 w-40" />
      </div>
      <Block className="h-16 w-full rounded-xl" />
      <Block className="h-11 w-full rounded-xl" />
      <div className="flex flex-col gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Block className="h-4 w-48" />
            <Block className="h-56 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
