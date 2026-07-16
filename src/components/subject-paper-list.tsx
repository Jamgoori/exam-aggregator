"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, RotateCcw, Shuffle } from "lucide-react";
import { createReviewFromPapers } from "@/app/mypage/wrong-notes/actions";
import { levelColor } from "@/lib/level-colors";

export type SubjectPaperItem = {
  paperId: string;
  title: string;
  level: string | null;
  attemptCount: number;
  latestScore: number | null;
  latestTotal: number | null;
  lastAttemptAt: string;
  unresolved: number;
};

// 과목 오답노트 "문제지별" 탭. 시험지 중심 재풀이: 카드마다 "틀린 문제 다시 풀기",
// 체크박스로 여러 시험지를 골라 하단에서 합쳐 풀 수 있다. 카드를 누르면 회독 기록과
// 틀린 문항·해설을 보는 드릴다운으로 간다.
export function SubjectPaperList({
  subjectSlug,
  papers,
}: {
  subjectSlug: string;
  papers: SubjectPaperItem[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 여러 시험지 중 어느 것을 눌러 시작했는지 표시(개별 버튼 스피너용).
  const [activePaper, setActivePaper] = useState<string | null>(null);

  function toggle(paperId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(paperId)) next.delete(paperId);
      else next.add(paperId);
      return next;
    });
  }

  function launch(paperIds: string[], marker: string | null) {
    if (pending) return;
    setError(null);
    setActivePaper(marker);
    start(async () => {
      const res = await createReviewFromPapers({ paperIds });
      if (res.error || !res.sessionId) {
        setError(res.error ?? "다시 풀기를 시작하지 못했어요.");
        setActivePaper(null);
        return;
      }
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${res.sessionId}`);
    });
  }

  return (
    <div className={`flex flex-col gap-3 ${selected.size > 0 ? "pb-24" : ""}`}>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs text-red-600 dark:bg-red-950/20 dark:text-red-400">
          {error}
        </p>
      )}

      {papers.map((p) => {
        const pctLabel =
          p.latestScore != null && p.latestTotal
            ? `${Math.round((p.latestScore / p.latestTotal) * 100)}점`
            : null;
        const checked = selected.has(p.paperId);
        return (
          <div
            key={p.paperId}
            className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
              checked
                ? "border-blue-400 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/20"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(p.paperId)}
                aria-label="시험지 선택"
                className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
              />
              <Link
                href={`/mypage/wrong-notes/${subjectSlug}/${p.paperId}`}
                className="group flex min-w-0 flex-1 items-start gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {p.level && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${levelColor(p.level)}`}
                      >
                        {p.level}
                      </span>
                    )}
                    <span className="font-medium leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400">
                      {p.title}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium dark:bg-zinc-800 dark:text-zinc-400">
                      {p.attemptCount}회독
                    </span>
                    {pctLabel && <span>최근 {pctLabel}</span>}
                    <span className="font-medium text-red-600 dark:text-red-400">
                      미극복 {p.unresolved}
                    </span>
                  </div>
                </div>
                <ChevronRight
                  size={16}
                  className="mt-0.5 shrink-0 text-zinc-300 group-hover:text-blue-600 dark:text-zinc-700 dark:group-hover:text-blue-400"
                />
              </Link>
            </div>

            <button
              type="button"
              onClick={() => launch([p.paperId], p.paperId)}
              disabled={pending}
              className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <RotateCcw size={15} />
              {pending && activePaper === p.paperId ? "준비 중..." : "틀린 문제 다시 풀기"}
            </button>
          </div>
        );
      })}

      {/* 여러 시험지 선택 → 합쳐 풀기. */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="flex w-full max-w-md items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              해제
            </button>
            <button
              type="button"
              onClick={() => launch([...selected], "multi")}
              disabled={pending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Shuffle size={15} />
              {pending && activePaper === "multi"
                ? "준비 중..."
                : `선택한 ${selected.size}개 시험지 합쳐 풀기`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
