"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, Clock, Trophy, X } from "lucide-react";
import { submitCbtAttempt, type CbtSubmitResult } from "@/app/papers/actions";

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${seconds}초`;
}

export function CbtSolver({
  paperId,
  paperTitle,
  fileUrl,
  totalQuestions,
  choiceCount,
  subjectName,
  examTypeName,
  level,
}: {
  paperId: string;
  paperTitle: string;
  fileUrl: string;
  totalQuestions: number;
  choiceCount: number;
  subjectName: string | null;
  examTypeName: string | null;
  level: string | null;
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(
    Array(totalQuestions).fill(null),
  );
  const [omrOpen, setOmrOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [result, setResult] = useState<CbtSubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const startedAtRef = useRef(0);

  useEffect(() => {
    startedAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    if (result) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [result]);

  const answeredCount = answers.filter((a) => a !== null).length;

  function selectChoice(questionIndex: number, choice: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[questionIndex] = next[questionIndex] === choice ? null : choice;
      return next;
    });
  }

  function handleSubmit() {
    if (isPending) return;
    if (
      answeredCount < totalQuestions &&
      !window.confirm(
        `아직 ${totalQuestions - answeredCount}문항을 안 풀었어요. 그래도 채점할까요?`,
      )
    ) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const res = await submitCbtAttempt({
        paperId,
        answers,
        durationSeconds: Math.floor((Date.now() - startedAtRef.current) / 1000),
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      setOmrOpen(false);
      setResult(res);
    });
  }

  function handleRetry() {
    setAnswers(Array(totalQuestions).fill(null));
    setResult(null);
    setError(null);
    startedAtRef.current = Date.now();
    setElapsedSeconds(0);
  }

  const resultByQuestion = new Map(
    (result?.questionResults ?? []).map((q) => [q.question_number, q]),
  );

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/papers/${paperId}`}
            aria-label="문제지로 돌아가기"
            className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100"
          >
            <ChevronLeft size={20} />
          </Link>
          <h1 className="truncate text-sm font-medium text-zinc-700">
            {paperTitle}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="flex items-center gap-1 text-sm font-medium text-zinc-600">
            <Clock size={16} />
            {formatDuration(elapsedSeconds)}
          </div>
          <button
            type="button"
            onClick={() => setOmrOpen(true)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 lg:hidden"
          >
            OMR
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <iframe
            src={`https://docs.google.com/gview?url=${encodeURIComponent(fileUrl)}&embedded=true`}
            title={paperTitle}
            className="h-full w-full"
          />
        </div>

        <OmrPanel
          className="hidden w-[360px] shrink-0 border-l border-zinc-200 lg:flex"
          subjectName={subjectName}
          examTypeName={examTypeName}
          level={level}
          totalQuestions={totalQuestions}
          choiceCount={choiceCount}
          answers={answers}
          answeredCount={answeredCount}
          onSelect={selectChoice}
          onSubmit={handleSubmit}
          submitting={isPending}
          error={error}
          resultByQuestion={result ? resultByQuestion : null}
        />
      </div>

      {omrOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end lg:hidden">
          <button
            type="button"
            aria-label="닫기"
            onClick={() => setOmrOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative flex max-h-[85dvh] flex-col rounded-t-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-zinc-700">OMR 답안지</h2>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setOmrOpen(false)}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100"
              >
                <X size={18} />
              </button>
            </div>
            <OmrPanel
              className="flex min-h-0 flex-1 flex-col"
              subjectName={subjectName}
              examTypeName={examTypeName}
              level={level}
              totalQuestions={totalQuestions}
              choiceCount={choiceCount}
              answers={answers}
              answeredCount={answeredCount}
              onSelect={selectChoice}
              onSubmit={handleSubmit}
              submitting={isPending}
              error={error}
              resultByQuestion={result ? resultByQuestion : null}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-white p-8 text-center shadow-xl">
            <Trophy size={40} className="text-amber-500" />
            <h2 className="text-lg font-semibold">채점 결과</h2>
            <p className="text-3xl font-bold text-blue-600">
              {result.score} / {result.totalQuestions}
            </p>
            <div className="flex w-full divide-x divide-zinc-100 rounded-xl border border-zinc-100">
              <div className="flex-1 py-3">
                <p className="text-xs text-zinc-400">정답률</p>
                <p className="mt-1 font-semibold text-zinc-700">
                  {Math.round(
                    ((result.score ?? 0) / (result.totalQuestions || 1)) * 100,
                  )}
                  %
                </p>
              </div>
              <div className="flex-1 py-3">
                <p className="text-xs text-zinc-400">풀이시간</p>
                <p className="mt-1 font-semibold text-zinc-700">
                  {formatDuration(result.durationSeconds ?? 0)}
                </p>
              </div>
            </div>
            <div className="flex w-full gap-2">
              <Link
                href={`/papers/${paperId}`}
                className="flex-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
              >
                문제지로
              </Link>
              <button
                type="button"
                onClick={handleRetry}
                className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                다시 풀기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OmrPanel({
  className,
  subjectName,
  examTypeName,
  level,
  totalQuestions,
  choiceCount,
  answers,
  answeredCount,
  onSelect,
  onSubmit,
  submitting,
  error,
  resultByQuestion,
}: {
  className: string;
  subjectName: string | null;
  examTypeName: string | null;
  level: string | null;
  totalQuestions: number;
  choiceCount: number;
  answers: (number | null)[];
  answeredCount: number;
  onSelect: (questionIndex: number, choice: number) => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
  resultByQuestion: Map<
    number,
    { selected_choice: number | null; is_correct: boolean }
  > | null;
}) {
  const graded = !!resultByQuestion;

  return (
    <div className={className}>
      <div className="flex shrink-0 flex-col gap-2 border-b border-zinc-100 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          {examTypeName && (
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              {examTypeName}
            </span>
          )}
          {level && (
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              {level}
            </span>
          )}
          {subjectName && (
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              {subjectName}
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-500">
          {answeredCount}/{totalQuestions} 문항 표기
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div
          className={`grid gap-2 ${choiceCount > 4 ? "grid-cols-1" : "grid-cols-2"}`}
        >
          {Array.from({ length: totalQuestions }, (_, i) => {
            const questionNumber = i + 1;
            const selected = answers[i];
            const questionResult = resultByQuestion?.get(questionNumber);
            return (
              <div
                key={questionNumber}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                  graded
                    ? questionResult?.is_correct
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-red-200 bg-red-50"
                    : "border-zinc-200"
                }`}
              >
                <span className="w-5 shrink-0 text-xs font-medium text-zinc-500">
                  {questionNumber}
                </span>
                <div className="flex flex-1 gap-1">
                  {Array.from({ length: choiceCount }, (_, c) => c + 1).map(
                    (choice) => (
                      <button
                        key={choice}
                        type="button"
                        disabled={graded}
                        onClick={() => onSelect(i, choice)}
                        className={`flex h-6 flex-1 items-center justify-center rounded text-xs font-medium ${
                          selected === choice
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                        } disabled:cursor-default disabled:hover:bg-zinc-100`}
                      >
                        {choice}
                      </button>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-zinc-100 px-4 py-3">
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || graded}
          className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {graded ? "채점 완료" : submitting ? "채점 중..." : "제출하고 채점하기"}
        </button>
      </div>
    </div>
  );
}
