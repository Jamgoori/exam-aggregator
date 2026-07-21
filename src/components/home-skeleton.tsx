// 홈 데이터(문제지 전체 목록 등)를 기다리는 동안 먼저 내보내는 껍데기.
// 실제 화면(home-exam-browser.tsx)과 같은 자리·같은 높이의 블록을 두어, 데이터가
// 도착해 내용이 채워질 때 레이아웃이 밀리지 않게 한다. 히어로의 제목·소개 문장은
// 데이터와 무관한 고정 텍스트라 스켈레톤 단계에서 진짜 문구를 그대로 보여준다.
function Block({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 ${className}`}
    />
  );
}

export function HomeSkeleton() {
  return (
    <>
      <section className="flex flex-col items-start gap-4">
        <Block className="h-6 w-40 rounded-full" />
        <h1 className="text-3xl font-bold text-black sm:text-4xl dark:text-zinc-100">
          나만의 <span className="text-blue-600 dark:text-blue-400">데이터</span>로,
          <br />
          합격까지 빠르게
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          국가직·지방직·소방·경찰 등 주요 공무원 시험 기출문제를 연도별·과목별로
          정리했어요.
        </p>

        {/* 검색창 자리 (SearchInput과 같은 폭·높이) */}
        <Block className="h-12 w-full max-w-[596px] rounded-xl" />

        {/* 통계 타일 3개 (PC 전용) */}
        <div className="mt-4 hidden w-full max-w-[596px] grid-cols-3 gap-3 sm:grid">
          <Block className="h-[104px] rounded-2xl" />
          <Block className="h-[104px] rounded-2xl" />
          <Block className="h-[104px] rounded-2xl" />
        </div>

        <Block className="mt-2 h-8 w-44 rounded-full" />
      </section>

      <section className="flex flex-col gap-4">
        {/* 급수 필터 버튼 줄 */}
        <div className="flex flex-wrap gap-2">
          <Block className="h-8 w-16 rounded-full" />
          <Block className="h-8 w-16 rounded-full" />
          <Block className="h-8 w-16 rounded-full" />
        </div>

        {/* 과목 색인 탭 */}
        <Block className="h-10 w-full rounded-lg" />

        <Block className="h-5 w-32" />

        {/* 카드 그리드 — 첫 화면에 실제로 보이는 만큼만 깔아준다 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Block key={i} className="h-[150px] rounded-xl" />
          ))}
        </div>
      </section>
    </>
  );
}
