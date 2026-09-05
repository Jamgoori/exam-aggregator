"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw, Shuffle } from "lucide-react";
import {
  WrongNoteLegend,
  WrongNoteQuestionCard,
  type WrongNoteCardRow,
} from "@/components/wrong-note-question-card";
import {
  WrongNoteMarkActions,
  WrongNoteUndoToast,
} from "@/components/wrong-note-mark-actions";
import { MemoEditor } from "@/components/memo-editor";
import { createRetryFromMix } from "@/app/mypage/wrong-notes/actions";
import { levelColor } from "@/lib/level-colors";
import { examTypeFilledColor } from "@/lib/exam-type-colors";
import type { MixSessionQuestion } from "@/lib/mix-practice";

type Filter = "wrong" | "all";

function toRow(q: MixSessionQuestion): WrongNoteCardRow {
  return {
    questionNumber: q.questionNumber,
    selectedChoice: q.selectedChoice,
    correctChoice: q.correctChoice,
    choiceCount: q.choiceCount,
    explanation: q.explanation,
    explanationLocked: q.explanationLocked,
    wrongCount: q.isCorrect ? undefined : q.wrongCount,
    resolved: q.isCorrect ? undefined : q.resolved,
  };
}

// "9월 5일 섞어풀기" 기록 페이지 본문. 기본은 그 세션에서 틀린 문항만(오답노트답게),
// 칩으로 전체 문항까지 볼 수 있다. 문항 카드는 과목 오답노트와 같은 것을 쓰므로 해설·
// 메모·다시 볼 문제 체크·삭제가 그대로 붙는다 — 사용자는 "오답노트의 카드 하나"로
// 읽으면 된다.
export function MixSessionView({
  sessionId,
  subjectSlug,
  questions,
  wrongCount,
  resolvedCount,
  lockNext,
}: {
  sessionId: string;
  subjectSlug: string;
  questions: MixSessionQuestion[];
  wrongCount: number;
  resolvedCount: number;
  lockNext: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(wrongCount > 0 ? "wrong" : "all");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 다시 볼 문제 체크/완전 삭제는 서버 왕복 없이 즉시 반영. 키는 `${paperId}#${qnum}`.
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(
    () => new Set(questions.filter((q) => q.pinned).map((q) => `${q.paperId}#${q.questionNumber}`)),
  );
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
  const [lastDeleted, setLastDeleted] = useState<{
    key: string;
    paperId: string;
    questionNumber: number;
  } | null>(null);

  const visible = useMemo(() => {
    const list = questions.filter(
      (q) => !deletedKeys.has(`${q.paperId}#${q.questionNumber}`),
    );
    return filter === "wrong" ? list.filter((q) => !q.isCorrect) : list;
  }, [questions, deletedKeys, filter]);

  function retryWrong() {
    if (pending || wrongCount === 0) return;
    setError(null);
    start(async () => {
      const res = await createRetryFromMix({ sessionId });
      if (res.error || !res.sessionId) {
        setError(res.error ?? "다시 풀기를 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${res.sessionId}`);
    });
  }

  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${
      active
        ? "bg-blue-600 text-white"
        : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        {wrongCount > 0 && (
          <button
            type="button"
            onClick={retryWrong}
            disabled={pending}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            <RotateCcw size={16} />
            {pending ? "준비 중..." : `틀린 ${wrongCount}문항 다시 풀기`}
          </button>
        )}
        <Link
          href={`/subjects/${subjectSlug}/mix`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 py-3 text-sm font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40"
        >
          <Shuffle size={16} />
          새로 섞어풀기
        </Link>
      </div>
      {error && (
        <p className="-mt-2 text-center text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFilter("wrong")}
          disabled={wrongCount === 0}
          className={`${chip(filter === "wrong")} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          틀린 문항 {wrongCount}
        </button>
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={chip(filter === "all")}
        >
          전체 {questions.length}문항
        </button>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        {filter === "wrong"
          ? `이 섞어풀기에서 틀린 문제예요. 그 뒤 다른 곳에서 맞힌 문제는 극복으로 표시돼요 (극복 ${resolvedCount} / ${wrongCount}).`
          : "이 섞어풀기에 나온 문제 전체예요. 답 표시는 그때 고른 답 기준이에요."}
      </p>

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-500">
          {filter === "wrong"
            ? "이 섞어풀기에서는 틀린 문제가 없어요. 완벽했어요! 🎉"
            : "보여줄 문항이 없어요."}
        </p>
      ) : (
        <>
          <WrongNoteLegend />
          <div className="flex flex-col gap-5">
            {visible.map((q) => {
              const key = `${q.paperId}#${q.questionNumber}`;
              return (
                <div key={q.position} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-500">
                    <span className="shrink-0 font-semibold text-zinc-400 dark:text-zinc-600">
                      {q.position + 1}번
                    </span>
                    {q.examTypeName && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${examTypeFilledColor(q.examTypeName)}`}
                      >
                        {q.examTypeName}
                      </span>
                    )}
                    {q.paperLevel && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${levelColor(q.paperLevel)}`}
                      >
                        {q.paperLevel}
                      </span>
                    )}
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">
                      {q.paperTitle} {q.questionNumber}번
                    </span>
                    {q.isCorrect && (
                      <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                        정답
                      </span>
                    )}
                  </div>
                  <WrongNoteQuestionCard
                    rows={[toRow(q)]}
                    images={q.images}
                    explanationLockNext={lockNext}
                    paperId={q.paperId}
                    reportContext="explanation"
                    renderRowActions={
                      q.isCorrect
                        ? undefined
                        : (questionNumber) => (
                            <WrongNoteMarkActions
                              paperId={q.paperId}
                              questionNumber={questionNumber}
                              pinned={pinnedKeys.has(key)}
                              onPinnedChange={(p) =>
                                setPinnedKeys((prev) => {
                                  const next = new Set(prev);
                                  if (p) next.add(key);
                                  else next.delete(key);
                                  return next;
                                })
                              }
                              onDeleted={() => {
                                setDeletedKeys((prev) => new Set(prev).add(key));
                                setLastDeleted({
                                  key,
                                  paperId: q.paperId,
                                  questionNumber,
                                });
                              }}
                            />
                          )
                    }
                  />
                  {!q.isCorrect && (
                    <div className="rounded-xl border border-zinc-100 dark:border-zinc-700/70">
                      <MemoEditor
                        paperId={q.paperId}
                        questionNumber={q.questionNumber}
                        initialMemo={q.memo}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {lastDeleted && (
        <WrongNoteUndoToast
          key={lastDeleted.key}
          paperId={lastDeleted.paperId}
          questionNumber={lastDeleted.questionNumber}
          onRestored={() => {
            setDeletedKeys((prev) => {
              const next = new Set(prev);
              next.delete(lastDeleted.key);
              return next;
            });
            setLastDeleted(null);
          }}
          onDismiss={() => setLastDeleted(null)}
        />
      )}
    </div>
  );
}
