"use client";

import { useState } from "react";
import { Trophy, X } from "lucide-react";

export type MyCbtRecordItem = {
  id: string;
  round: number;
  score: number;
  totalQuestions: number;
  createdAt: string;
};

export function MyCbtRecordModal({ attempts }: { attempts: MyCbtRecordItem[] }) {
  const [open, setOpen] = useState(false);

  if (attempts.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
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
            className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">내 CBT 기록</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="text-zinc-400 hover:text-zinc-600"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-4 flex max-h-80 flex-col divide-y divide-zinc-100 overflow-y-auto">
              {attempts.map((a) => {
                const pct =
                  a.totalQuestions > 0 ? Math.round((a.score / a.totalQuestions) * 100) : 0;
                return (
                  <div key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="flex items-center gap-2">
                      <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">
                        {a.round}회독
                      </span>
                      <span className="text-xs text-zinc-400">
                        {new Date(a.createdAt).toLocaleDateString("ko-KR")}
                      </span>
                    </span>
                    <span className="font-semibold">
                      {a.score}/{a.totalQuestions}{" "}
                      <span className="font-normal text-zinc-400">({pct}점)</span>
                    </span>
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
