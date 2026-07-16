"use client";

import { useMemo, useState } from "react";
import {
  groupRowsBySharedImages,
  WrongNoteLegend,
  WrongNoteQuestionCard,
  type QuestionExplanationContent,
} from "@/components/wrong-note-question-card";

export type PaperViewQuestion = {
  questionNumber: number;
  lastSelectedChoice: number | null;
  correctChoice: number | null;
  choiceCount: number;
  images: string[];
  explanation: QuestionExplanationContent | null;
  wrongCount: number;
  resolved: boolean;
};

export type PaperViewRound = {
  attemptId: string;
  round: number;
  score: number;
  totalQuestions: number;
  createdAt: string;
  wrong: { questionNumber: number; selectedChoice: number | null }[];
};

// "통합"(모든 회독 합산)이 기본. 회독 칩을 누르면 그 회독에서 틀린 문제만,
// 그때 실제로 고른 답과 함께 보여준다.
type ViewKey = "all" | string;

function pct(score: number, total: number): number {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR");
}

// 문제지 오답노트의 본문. 회독 전환과 극복 필터가 서버 왕복 없이 즉시 바뀌어야
// 해서 클라이언트 컴포넌트로 뒀다 (과목 페이지 필터와 같은 이유).
export function WrongNotePaperView({
  questions,
  rounds,
  unresolvedCount,
}: {
  questions: PaperViewQuestion[];
  rounds: PaperViewRound[];
  unresolvedCount: number;
}) {
  const [view, setView] = useState<ViewKey>("all");
  // "아직 틀리는 문제만" 필터는 통합 보기에서만 의미가 있다.
  const [hideResolved, setHideResolved] = useState(false);

  const byNumber = useMemo(
    () => new Map(questions.map((q) => [q.questionNumber, q])),
    [questions],
  );

  const selectedRound =
    view === "all" ? null : (rounds.find((r) => r.attemptId === view) ?? null);

  // 카드에 그릴 줄 목록: 통합이면 누적 오답 전체(가장 최근에 고른 답 기준),
  // 회독이면 그 회독의 오답만(그 회독에서 고른 답 기준).
  const items = useMemo(() => {
    if (!selectedRound) {
      return questions
        .filter((q) => !hideResolved || !q.resolved)
        .map((q) => ({
          images: q.images,
          questionNumber: q.questionNumber,
          selectedChoice: q.lastSelectedChoice,
          correctChoice: q.correctChoice,
          choiceCount: q.choiceCount,
          explanation: q.explanation,
          wrongCount: q.wrongCount,
          resolved: q.resolved,
        }));
    }
    return selectedRound.wrong
      .map((w) => {
        const q = byNumber.get(w.questionNumber);
        if (!q) return null;
        return {
          images: q.images,
          questionNumber: q.questionNumber,
          selectedChoice: w.selectedChoice,
          correctChoice: q.correctChoice,
          choiceCount: q.choiceCount,
          explanation: q.explanation,
          wrongCount: q.wrongCount,
          resolved: q.resolved,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.questionNumber - b.questionNumber);
  }, [questions, selectedRound, hideResolved, byNumber]);

  const groups = useMemo(() => groupRowsBySharedImages(items), [items]);

  return (
    <div className="flex flex-col gap-4">
      {/* 회독 스트립: 통합 + 회독별 점수/오답 수. 모바일에서는 가로 스크롤. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <button
          type="button"
          onClick={() => setView("all")}
          className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
            view === "all"
              ? "bg-blue-600 text-white"
              : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
          }`}
        >
          전체 회독 · 미극복 {unresolvedCount}
        </button>
        {rounds.map((r) => (
          <button
            key={r.attemptId}
            type="button"
            onClick={() => setView(r.attemptId)}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm ${
              view === r.attemptId
                ? "bg-blue-600 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
            }`}
          >
            <span className="font-semibold">{r.round}회독</span>
            <span
              className={
                view === r.attemptId ? "text-blue-100" : "text-zinc-400 dark:text-zinc-600"
              }
            >
              {" "}
              · {pct(r.score, r.totalQuestions)}점 · 그때 오답 {r.wrong.length}
            </span>
          </button>
        ))}
      </div>

      {/* 지금 보고 있는 것이 무엇인지 한 줄로 설명해주는 컨텍스트. */}
      {selectedRound ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          {formatDate(selectedRound.createdAt)} 응시 · {selectedRound.totalQuestions}
          문항 중 {selectedRound.score}문항 정답 · 이 회독에서 틀린 문제를 그때 고른
          답과 함께 보여드려요.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            모든 회독을 합친 보기예요. 답 표시는 가장 최근에 틀렸을 때 기준이에요.
          </p>
          {questions.some((q) => q.resolved) && (
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                checked={hideResolved}
                onChange={(e) => setHideResolved(e.target.checked)}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              극복한 문제 숨기기
            </label>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-500">
          {selectedRound
            ? "이 회독에서는 틀린 문제가 없어요. 완벽했어요! 🎉"
            : "아직 틀리는 문제가 없어요. 모든 오답을 극복했어요! 🎉"}
        </p>
      ) : (
        <>
          <WrongNoteLegend />
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <WrongNoteQuestionCard
                key={`${view}-${group.rows[0].questionNumber}`}
                rows={group.rows}
                images={group.images}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
