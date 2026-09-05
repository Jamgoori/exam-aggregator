import Link from "next/link";
import { ChevronRight, Shuffle } from "lucide-react";
import type { MixSessionSummary } from "@/lib/mix-practice";
import { KST_TIME_ZONE } from "@gongmoa/core";

// 오답노트 과목 페이지("문제지별" 탭)와 섞어풀기 시작 화면이 함께 쓰는 섞어풀기 기록
// 카드 목록. 카드 하나가 세션 하나("9월 5일 섞어풀기")이고, 누르면 그 세션에서 틀린
// 문항·해설을 보는 기록 페이지로 간다. 훅이 없는 표시 전용이라 서버 컴포넌트에서
// 그대로 쓴다(문제지 카드 SubjectPaperList 와 같은 모양으로 맞췄다).
export function MixSessionList({
  subjectSlug,
  sessions,
}: {
  subjectSlug: string;
  sessions: MixSessionSummary[];
}) {
  if (sessions.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {sessions.map((s) => {
        const pct = s.total > 0 ? Math.round((s.score / s.total) * 100) : 0;
        const cleared = s.wrongCount > 0 && s.resolvedCount >= s.wrongCount;
        const remaining = Math.max(0, s.wrongCount - s.resolvedCount);
        const resolvedPct =
          s.wrongCount > 0 ? Math.round((s.resolvedCount / s.wrongCount) * 100) : 0;
        const time = new Date(s.createdAt).toLocaleTimeString("ko-KR", {
          timeZone: KST_TIME_ZONE,
          hour: "numeric",
          minute: "2-digit",
        });
        return (
          <Link
            key={s.id}
            href={`/mypage/wrong-notes/${subjectSlug}/mix/${s.id}`}
            className="group flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
          >
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex shrink-0 items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                    <Shuffle size={11} />
                    섞어풀기
                  </span>
                  <span className="font-semibold leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400">
                    {s.title}
                  </span>
                  <span className="text-xs text-zinc-400 dark:text-zinc-600">{time}</span>
                </div>

                {s.wrongCount > 0 ? (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-600 dark:text-zinc-300">
                        극복 {s.resolvedCount} / {s.wrongCount}문항
                      </span>
                      {cleared ? (
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          모두 극복 🎉
                        </span>
                      ) : (
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          남은 오답 {remaining}
                        </span>
                      )}
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${resolvedPct}%` }}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    전부 맞혔어요 🎉
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
                  <span>
                    점수{" "}
                    <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                      {s.score}/{s.total} ({pct}점)
                    </span>
                  </span>
                </div>
              </div>
              <ChevronRight
                size={16}
                className="mt-0.5 shrink-0 text-zinc-300 group-hover:text-blue-600 dark:text-zinc-700 dark:group-hover:text-blue-400"
              />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
