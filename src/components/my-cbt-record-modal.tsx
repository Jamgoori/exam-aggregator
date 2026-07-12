"use client";

import { useState } from "react";
import { Trophy, TrendingDown, TrendingUp, X } from "lucide-react";

export type MyCbtRecordItem = {
  id: string;
  round: number;
  score: number;
  totalQuestions: number;
  createdAt: string;
};

export type RoundAverage = {
  round: number;
  avgPct: number;
  attemptCount: number;
};

export function MyCbtRecordModal({
  attempts,
  roundAverages,
}: {
  attempts: MyCbtRecordItem[];
  roundAverages: RoundAverage[];
}) {
  const [open, setOpen] = useState(false);

  if (attempts.length === 0) return null;

  const averageByRound = new Map(roundAverages.map((r) => [r.round, r]));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400 dark:hover:bg-amber-900/40"
      >
        <Trophy size={13} />
        내 기록보기
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-lg font-semibold dark:text-zinc-100">
                <Trophy size={18} className="text-blue-600 dark:text-blue-400" />
                내 시험 기록
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 flex max-h-96 flex-col gap-2.5 overflow-y-auto">
              {attempts.map((a) => {
                const pct =
                  a.totalQuestions > 0 ? Math.round((a.score / a.totalQuestions) * 100) : 0;
                const avg = averageByRound.get(a.round);
                const diff = avg ? Math.round((pct - avg.avgPct) * 10) / 10 : null;

                return (
                  <div
                    key={a.id}
                    className="rounded-xl border border-zinc-100 bg-zinc-50 px-3.5 py-3 dark:border-zinc-800 dark:bg-zinc-800/50"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900/50 dark:text-blue-400">
                          {a.round}
                        </span>
                        <span className="text-xs text-zinc-400 dark:text-zinc-600">
                          {new Date(a.createdAt).toLocaleDateString("ko-KR")}
                        </span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{pct}점</span>
                        <span className="text-xs text-zinc-400 dark:text-zinc-600">
                          {a.score}/{a.totalQuestions}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between border-t border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
                      {avg && diff !== null ? (
                        <>
                          <span>
                            경쟁자 {a.round}회독 평균 {avg.avgPct}점
                          </span>
                          <span
                            className={`flex items-center gap-0.5 font-medium ${
                              diff >= 0 ? "text-blue-600 dark:text-blue-400" : "text-zinc-400 dark:text-zinc-600"
                            }`}
                          >
                            {diff >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            평균보다 {diff >= 0 ? "+" : ""}
                            {diff}점
                          </span>
                        </>
                      ) : (
                        <span className="ml-auto text-zinc-400 dark:text-zinc-600">
                          경쟁자 {a.round}회독 평균 데이터 수집중
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
