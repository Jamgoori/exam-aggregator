// 관리자 화면 공용 스켈레톤 — admin 하위 라우트에 개별 loading이 없으므로
// 이 파일 하나가 업로드/정답/해설 화면 전환을 모두 받쳐준다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function AdminLoading() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-12">
      <Block className="h-8 w-48" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Block key={i} className="h-12 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
