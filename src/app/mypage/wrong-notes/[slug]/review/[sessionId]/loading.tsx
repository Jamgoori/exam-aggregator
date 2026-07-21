// 섞어풀기(복습) 풀이 화면 스켈레톤 — CBT 풀이 화면과 같은 몰입형 구도.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function ReviewSessionLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-4">
      <div className="flex items-center justify-between">
        <Block className="h-8 w-24" />
        <Block className="h-8 w-20 rounded-full" />
        <Block className="h-8 w-8 rounded-full" />
      </div>
      <Block className="h-[60vh] w-full rounded-xl" />
      <div className="flex items-center justify-center gap-1.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Block key={i} className="h-9 w-9 rounded-full" />
        ))}
      </div>
    </div>
  );
}
