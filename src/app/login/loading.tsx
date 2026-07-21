// 로그인 화면 스켈레톤: 제목 + 소셜 로그인 버튼 2개 자리.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function LoginLoading() {
  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <div className="flex flex-col gap-2">
        <Block className="h-8 w-24" />
        <Block className="h-4 w-52" />
      </div>
      <div className="flex flex-col gap-3">
        <Block className="h-11 w-full" />
        <Block className="h-11 w-full" />
      </div>
    </div>
  );
}
