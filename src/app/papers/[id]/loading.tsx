// 문제지 상세페이지는 댓글·평점·회독기록 등 12개 가까운 쿼리를 병렬로 묶어서
// 조회하다 보니 첫 로딩에 짧은 정적이 생긴다. Next.js가 이 라우트로의 이동이
// 즉시 끝나지 않을 때만 자동으로 이 화면을 보여주므로(빠른 이동에는 아예 안
// 뜬다), 실제 페이지(page.tsx)·구성요소(difficulty-rating.tsx, exam-card.tsx,
// comments-section.tsx)와 최대한 같은 모양의 블록을 미리 깔아 "멈춘 게 아니라
// 곧 채워진다"는 느낌을 준다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

// difficulty-rating.tsx의 9칸 계단식 막대 게이지와 같은 모양(높이가 14px에서
// 3px씩 커짐)을 그대로 흉내낸다.
function DifficultyGaugeSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <Block className="h-4 w-16" />
      <Block className="h-4 w-32" />
      <div className="flex flex-col gap-1 pt-8">
        <div className="flex items-end gap-1">
          {Array.from({ length: 9 }, (_, i) => (
            <div
              key={i}
              className="skeleton w-full flex-1 rounded-sm"
              style={{ height: `${14 + i * 3}px` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// exam-card.tsx와 같은 배지행(좌)+북마크(우) / 제목 / 구분선 아래 바로풀기·자세히
// 보기 자리를 그대로 맞춘 카드 스켈레톤.
function ExamCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Block className="h-5 w-10 rounded" />
          <Block className="h-5 w-14 rounded" />
        </div>
        <Block className="h-7 w-7 shrink-0 rounded-full" />
      </div>
      <Block className="h-4 w-full" />
      <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <Block className="h-5 w-16 rounded-full" />
        <Block className="h-4 w-16" />
      </div>
    </div>
  );
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
          {/* 문제 열기/다운로드 */}
          <div className="flex items-stretch gap-2">
            <Block className="h-16 flex-1 rounded-xl" />
            <Block className="h-16 w-16 shrink-0 rounded-xl" />
          </div>
          {/* 정답 열기/다운로드 */}
          <div className="flex items-stretch gap-2">
            <Block className="h-16 flex-1 rounded-xl" />
            <Block className="h-16 w-16 shrink-0 rounded-xl" />
          </div>
          {/* 온라인에서 풀기 */}
          <Block className="h-16 w-full rounded-xl" />
          <Block className="h-16 w-full rounded-xl" />
        </div>

        <DifficultyGaugeSkeleton />

        <div className="flex flex-col gap-5">
          <Block className="h-5 w-28" />
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Block className="h-9 w-full rounded-lg sm:w-40" />
              <Block className="h-9 w-full rounded-lg sm:w-52" />
            </div>
            <Block className="h-16 w-full rounded-lg" />
            <Block className="h-9 w-24 self-end rounded-lg" />
          </div>
          <div className="flex flex-col gap-4 divide-y divide-zinc-100 dark:divide-zinc-800">
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

      <div className="flex flex-col gap-4 border-t border-zinc-100 pt-14 dark:border-zinc-800">
        <div className="flex items-center justify-between gap-4">
          <Block className="h-5 w-40" />
          <Block className="h-4 w-14" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Block className="h-8 w-14 rounded-full" />
          <Block className="h-8 w-14 rounded-full" />
          <Block className="h-8 w-14 rounded-full" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <ExamCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
