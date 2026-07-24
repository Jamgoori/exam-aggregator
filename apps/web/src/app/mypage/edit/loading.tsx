// 내 정보 수정 화면 스켈레톤: 제목 → 폼 필드(닉네임·CBT 보기 방식) 자리.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function EditAccountLoading() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <Block className="h-4 w-24" />
        <Block className="h-8 w-40" />
      </div>
      <div className="flex flex-col gap-2">
        <Block className="h-4 w-16" />
        <Block className="h-11 w-full rounded-xl" />
      </div>
      <div className="flex flex-col gap-2">
        <Block className="h-4 w-28" />
        <Block className="h-11 w-full rounded-xl" />
      </div>
      <Block className="h-11 w-full rounded-xl" />
    </div>
  );
}
