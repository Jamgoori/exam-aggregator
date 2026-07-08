// 문제지 상세페이지는 댓글·평점·회독기록 등 12개 가까운 쿼리를 병렬로 묶어서
// 조회하다 보니 첫 로딩에 짧은 정적이 생긴다. Next.js가 이 라우트로의 이동이
// 즉시 끝나지 않을 때만 자동으로 이 화면을 보여주므로(빠른 이동에는 아예 안
// 뜬다), 실제 페이지와 같은 모양의 블록을 미리 깔아 "멈춘 게 아니라 곧
// 채워진다"는 느낌을 준다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

export default function PaperDetailLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-14 px-4 pb-12 pt-6 sm:pt-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-14">
        <div className="flex flex-col gap-4">
          <Block className="h-4 w-20" />

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Block className="h-6 w-12 rounded" />
              <Block className="h-6 w-16 rounded" />
            </div>
            <Block className="h-9 w-9 shrink-0 rounded-full" />
          </div>

          <div className="flex flex-col gap-3">
            <Block className="h-8 w-full max-w-md" />
            <Block className="h-4 w-64" />
            <Block className="h-3 w-40" />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-stretch gap-2">
            <Block className="h-16 flex-1 rounded-xl" />
            <Block className="h-16 w-16 shrink-0 rounded-xl" />
          </div>
          <Block className="h-16 w-full rounded-xl" />
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {Array.from({ length: 5 }, (_, i) => (
                <Block key={i} className="h-6 w-6 rounded" />
              ))}
            </div>
            <Block className="h-4 w-24" />
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <Block className="h-5 w-28" />
          <Block className="h-24 w-full rounded-lg" />
          <div className="flex flex-col gap-4 divide-y divide-zinc-100">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="flex flex-col gap-2 pt-4 first:pt-0">
                <div className="flex items-center gap-2">
                  <Block className="h-4 w-16" />
                  <Block className="h-3 w-12" />
                </div>
                <Block className="h-4 w-full" />
                <Block className="h-4 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 border-t border-zinc-100 pt-14">
        <div className="flex items-center justify-between gap-4">
          <Block className="h-5 w-40" />
          <Block className="h-4 w-14" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4"
            >
              <div className="flex items-center gap-2">
                <Block className="h-5 w-10 rounded" />
                <Block className="h-5 w-14 rounded" />
              </div>
              <Block className="h-4 w-full" />
              <Block className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
