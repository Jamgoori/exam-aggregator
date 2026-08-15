import Link from "next/link";
import { Lock, Users } from "lucide-react";
import { ROUND_AVERAGE_MIN_SAMPLE } from "@gongmoa/core";
import type { PaperRoundComparison } from "@/lib/wrong-notes";

// 회독별 "나 vs 다른 회원 평균" 비교(멤버십 전용). 내 점수만 보면 그게 잘한 건지
// 알 수 없어서, 같은 문제지를 같은 회독만큼 푼 사람들과 견줘 보여준다.
//
// 평균은 나를 뺀 값이다(othersRoundAveragePct). 표본이 모자란 회독은 평균 자리를
// 비우고 이유를 적는다 — 두세 명짜리 평균을 "평균"이라고 내밀면 그 자체로 오해다.
export function RoundAverageCompare({
  comparisons,
  premium,
  // 결제 페이지에서 돌아올 곳.
  next,
  // 지금 보고 있는 회독(전체 보기면 null). 그 줄을 강조한다.
  selectedRound,
}: {
  comparisons: PaperRoundComparison[];
  premium: boolean;
  next: string;
  selectedRound: number | null;
}) {
  if (!premium) {
    return (
      <Link
        href={`/membership?next=${encodeURIComponent(next)}`}
        className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 transition-colors hover:border-blue-300 hover:bg-blue-50/50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
      >
        <Lock size={14} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
        <p className="min-w-0 flex-1 text-xs text-zinc-600 dark:text-zinc-400">
          <span className="font-bold text-zinc-700 dark:text-zinc-300">
            다른 회원들의 회독별 평균 점수
          </span>
          <span className="text-zinc-500 dark:text-zinc-500">
            {" "}
            · 같은 시험지를 같은 회독만큼 푼 사람들과 내 점수를 비교해요
          </span>
        </p>
        <span className="shrink-0 text-xs font-bold text-blue-600 dark:text-blue-400">
          멤버십 ›
        </span>
      </Link>
    );
  }

  if (comparisons.length === 0) return null;

  const hasAnyAverage = comparisons.some((c) => c.othersAvgPct !== null);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 px-3.5 py-3 dark:border-zinc-700">
      <p className="flex items-center gap-1.5 text-xs font-bold text-zinc-700 dark:text-zinc-300">
        <Users size={13} className="shrink-0 text-blue-600 dark:text-blue-400" />
        회독별 점수 비교
        <span className="font-medium text-zinc-400 dark:text-zinc-500">
          (나 · 다른 회원 평균)
        </span>
      </p>

      {hasAnyAverage ? (
        <div className="flex flex-col gap-1.5">
          {comparisons.map((c) => (
            <CompareRow key={c.round} row={c} highlighted={selectedRound === c.round} />
          ))}
        </div>
      ) : (
        // 회독 번호가 올라갈수록 표본이 급격히 줄어 흔한 경우다. 자리만 비워두면
        // "왜 안 뜨지"가 되므로 이유를 적는다.
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          아직 이 시험지를 이만큼 푼 회원이 적어서 평균을 낼 수 없어요 (회독당 최소{" "}
          {ROUND_AVERAGE_MIN_SAMPLE}명 필요).
        </p>
      )}
    </div>
  );
}

function CompareRow({
  row,
  highlighted,
}: {
  row: PaperRoundComparison;
  highlighted: boolean;
}) {
  const diff = row.othersAvgPct === null ? null : row.myPct - row.othersAvgPct;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-2 py-1.5 text-xs ${
        highlighted ? "bg-blue-50 dark:bg-blue-950/30" : ""
      }`}
    >
      <span className="w-12 shrink-0 font-semibold text-zinc-600 dark:text-zinc-400">
        {row.round}회독
      </span>
      <span className="shrink-0 text-zinc-500 dark:text-zinc-500">
        나 <span className="font-bold text-zinc-800 dark:text-zinc-200">{row.myPct}점</span>
      </span>
      {row.othersAvgPct === null ? (
        <span className="text-zinc-400 dark:text-zinc-600">
          다른 회원 {row.othersCount}명 · 평균을 내기엔 표본이 적어요
        </span>
      ) : (
        <>
          <span className="shrink-0 text-zinc-500 dark:text-zinc-500">
            평균{" "}
            <span className="font-bold text-zinc-700 dark:text-zinc-300">
              {row.othersAvgPct}점
            </span>
          </span>
          {/* 차이는 "잘했다/못했다"가 아니라 위치를 알려주는 값이라, 낮을 때도
              빨강(오답 색)을 쓰지 않고 회색으로 담담하게 둔다. */}
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 font-bold ${
              diff! > 0
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400"
                : diff! < 0
                  ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
            }`}
          >
            {diff! > 0 ? `+${diff}` : diff === 0 ? "±0" : diff}
          </span>
          <span className="shrink-0 text-zinc-400 dark:text-zinc-600">
            ({row.othersCount}명)
          </span>
        </>
      )}
    </div>
  );
}
