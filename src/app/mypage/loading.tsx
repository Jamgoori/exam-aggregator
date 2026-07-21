import type { CSSProperties } from "react";

// 마이페이지 진입 스켈레톤. 문제지 상세페이지처럼 "곧 채워질 자리"를 그리되,
// 상세페이지 블록을 복붙하지 않고 마이페이지 실제 화면(인사말 → 통계 타일 3개 →
// 탭 → 오답노트 목록)의 구도를 따로 그렸다. 각 구역에 --skeleton-delay를 계단식으로
// 줘서 반짝임이 위에서 아래로 차례로 훑고 내려가는 폭포 연출을 낸다.
function Block({
  className = "",
  delay = 0,
}: {
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={`skeleton rounded-lg ${className}`}
      style={{ "--skeleton-delay": `${delay}s` } as CSSProperties}
    />
  );
}

// CBT 응시 / 연속 학습 / 남은 오답 타일. 실제 타일처럼 작은 라벨 + 큰 숫자 구도,
// 연속 학습 타일(가운데)에는 티어 배지 자리까지 흉내낸다.
function StatTileSkeleton({ delay, withBadge }: { delay: number; withBadge?: boolean }) {
  return (
    <div className="flex min-w-[7rem] flex-1 flex-col gap-1.5 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
      <Block className="h-3 w-12" delay={delay} />
      <div className="flex items-baseline gap-1.5">
        <Block className="h-7 w-12" delay={delay} />
        {withBadge && <Block className="h-4 w-10 rounded-full" delay={delay} />}
      </div>
    </div>
  );
}

// 기본 탭(오답노트)의 과목 카드: 과목 배지 + "남은 오답 N · 극복 N" 문구 +
// 오른쪽 "오답 보기" 링크 + 아래 극복 진행률 바까지 실제 카드와 같은 구도.
function WrongNoteCardSkeleton({ delay }: { delay: number }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex items-center gap-3">
        <Block className="h-5 w-14 rounded" delay={delay} />
        <Block className="h-4 w-36" delay={delay} />
        <Block className="ml-auto h-4 w-16" delay={delay} />
      </div>
      <div className="flex items-center gap-2">
        <Block className="h-1.5 flex-1 rounded-full" delay={delay} />
        <Block className="h-3 w-10" delay={delay} />
      </div>
    </div>
  );
}

export default function MyPageLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-12 pt-6 sm:pt-8">
      {/* ← 홈으로 / {닉네임}님의 마이페이지 / 내 정보 수정 */}
      <div className="flex flex-col gap-2.5">
        <Block className="h-4 w-16" />
        <Block className="h-9 w-64 sm:w-80" />
        <Block className="h-4 w-20" />
      </div>

      <div className="flex flex-wrap gap-3">
        <StatTileSkeleton delay={0.1} />
        <StatTileSkeleton delay={0.15} withBadge />
        <StatTileSkeleton delay={0.2} />
      </div>

      {/* 탭 알약 3개 — 첫 탭이 활성(파란 채움)인 것까지 흉내 */}
      <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        <div
          className="skeleton h-8 w-20 rounded-full !bg-blue-200 dark:!bg-blue-900/60"
          style={{ "--skeleton-delay": "0.25s" } as CSSProperties}
        />
        <Block className="h-8 w-24 rounded-full" delay={0.3} />
        <Block className="h-8 w-20 rounded-full" delay={0.35} />
      </div>

      {/* 오답노트 탭: 섹션 제목 → AI 진단 배너 → 사용법 스트립 → 과목 카드들 */}
      <div className="flex flex-col gap-4">
        <Block className="h-6 w-24" delay={0.4} />
        <Block className="h-14 w-full rounded-xl" delay={0.45} />
        <Block className="h-24 w-full rounded-xl sm:h-11" delay={0.5} />
        <div className="flex flex-col gap-3">
          <WrongNoteCardSkeleton delay={0.55} />
          <WrongNoteCardSkeleton delay={0.6} />
          <WrongNoteCardSkeleton delay={0.65} />
        </div>
      </div>
    </div>
  );
}
