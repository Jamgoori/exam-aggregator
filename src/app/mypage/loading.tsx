// 마이페이지는 응시 기록·오답 집계·진단 배너까지 여러 조회가 이어져 첫 진입이
// 느릴 수 있으므로, 문제지 상세페이지처럼 실제 페이지(헤더 → 통계 타일 3개 →
// 탭 → 오답노트 목록)와 같은 모양의 스켈레톤을 깔아 "멈춘 게 아니라 곧
// 채워진다"는 느낌을 준다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

// mypage-tabs.tsx의 탭 알약 3개(오답노트/내 시험 기록/즐겨찾기)와 같은 자리.
function TabsSkeleton() {
  return (
    <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
      <Block className="h-8 w-20 rounded-full" />
      <Block className="h-8 w-24 rounded-full" />
      <Block className="h-8 w-20 rounded-full" />
    </div>
  );
}

// 기본 탭(오답노트)의 과목 카드와 같은 모양: 배지 + 요약 문구 + 진행률 바.
function WrongNoteCardSkeleton() {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex items-center gap-3">
        <Block className="h-5 w-14 rounded" />
        <Block className="h-4 w-32" />
        <Block className="ml-auto h-4 w-16" />
      </div>
      <div className="flex items-center gap-2">
        <Block className="h-1.5 flex-1 rounded-full" />
        <Block className="h-3 w-10" />
      </div>
    </div>
  );
}

export default function MyPageLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-12 pt-6 sm:pt-8">
      <div className="flex flex-col gap-2">
        <Block className="h-4 w-16" />
        <Block className="h-9 w-full max-w-xs" />
        <Block className="h-4 w-24" />
      </div>

      {/* CBT 응시 / 연속 학습 / 남은 오답 통계 타일 3개 */}
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700"
          >
            <Block className="h-3 w-14" />
            <Block className="h-7 w-16" />
          </div>
        ))}
      </div>

      <TabsSkeleton />

      {/* 오답노트 탭: 제목 → 진단 배너 → 사용법 스트립 → 과목 카드 목록 */}
      <div className="flex flex-col gap-4">
        <Block className="h-6 w-24" />
        <Block className="h-14 w-full rounded-xl" />
        <Block className="h-24 w-full rounded-xl sm:h-11" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <WrongNoteCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
