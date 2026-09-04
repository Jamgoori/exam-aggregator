// 자기 loading.tsx 가 없는 라우트(과목·시험 허브, 요금제, 공지 등)가 공통으로 쓰는
// 스켈레톤. 제목 한 줄과 문단, 그 아래 카드 몇 장 — 대부분의 안내형 페이지가 그 구도다.
// 기출문제 목록은 자기 스켈레톤(papers/loading.tsx)을 따로 가진다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function PageLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-6 pb-12 sm:pt-8">
      <div className="flex flex-col gap-3">
        <Block className="h-9 w-64 sm:h-10 sm:w-80" />
        <Block className="h-4 w-full max-w-md" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Block key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
