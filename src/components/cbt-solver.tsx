"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronLeft, Clock, Eraser, PenLine, Trophy, X } from "lucide-react";
import { submitCbtAttempt, type CbtSubmitResult } from "@/app/papers/actions";

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}분 ${seconds}초`;
}

const PEN_COLORS = ["#111827", "#ef4444", "#2563eb"];

export function CbtSolver({
  paperId,
  paperTitle,
  fileUrl,
  totalQuestions,
  choiceCount,
}: {
  paperId: string;
  paperTitle: string;
  fileUrl: string;
  totalQuestions: number;
  choiceCount: number;
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
  const [penMode, setPenMode] = useState(false);
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    startedAtRef.current = Date.now();
  }, []);

  // PDF 위에 필기하는 캔버스는 iframe(PDF)과 별개 레이어라, PDF를 스크롤/확대해도
  // 필기 내용은 그 위치를 따라가지 않고 화면에 고정된 채로 남는다 (단순 메모용).
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;

    function resize() {
      if (!canvas || !container) return;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    }
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  function getCanvasPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePenDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!penMode) return;
    drawingRef.current = true;
    lastPointRef.current = getCanvasPoint(e);
  }

  function handlePenMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!penMode || !drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const last = lastPointRef.current;
    if (!ctx || !last) return;
    const point = getCanvasPoint(e);
    ctx.strokeStyle = penColor;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  }

  function handlePenUp() {
    drawingRef.current = false;
    lastPointRef.current = null;
  }

  function clearDrawing() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

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
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex items-center gap-1 text-sm font-medium text-zinc-600">
            <Clock size={16} />
            {formatDuration(elapsedSeconds)}
          </div>
          <button
            type="button"
            onClick={() => setPenMode((v) => !v)}
            aria-pressed={penMode}
            className={`flex items-center justify-center rounded-lg p-1.5 ${
              penMode
                ? "bg-blue-600 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            <PenLine size={18} />
          </button>
          <button
            type="button"
            onClick={() => setOmrOpen(true)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 lg:hidden"
          >
            OMR
          </button>
        </div>
      </header>

      {penMode && (
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3 py-1.5">
          {PEN_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label="펜 색상"
              onClick={() => setPenColor(color)}
              style={{ backgroundColor: color }}
              className={`h-5 w-5 rounded-full ${
                penColor === color ? "ring-2 ring-offset-1 ring-zinc-400" : ""
              }`}
            />
          ))}
          <button
            type="button"
            onClick={clearDrawing}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700"
          >
            <Eraser size={14} />
            지우기
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <iframe
            src={`https://docs.google.com/gview?url=${encodeURIComponent(fileUrl)}&embedded=true`}
            title={paperTitle}
            className="h-full w-full"
          />
          <canvas
            ref={canvasRef}
            onPointerDown={handlePenDown}
            onPointerMove={handlePenMove}
            onPointerUp={handlePenUp}
            onPointerLeave={handlePenUp}
            className={`absolute inset-0 h-full w-full touch-none ${
              penMode ? "pointer-events-auto" : "pointer-events-none"
            }`}
          />
        </div>

        <OmrPanel
          className="hidden w-[360px] shrink-0 border-l border-zinc-200 lg:flex"
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
          <div className="relative flex max-h-[65dvh] flex-col rounded-t-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2">
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
      <div className="shrink-0 border-b border-zinc-100 px-4 py-2">
        <p className="text-sm text-zinc-500">
          {answeredCount}/{totalQuestions} 문항 표기
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <div
          className={`grid gap-1.5 ${choiceCount > 4 ? "grid-cols-1" : "grid-cols-2"}`}
        >
          {Array.from({ length: totalQuestions }, (_, i) => {
            const questionNumber = i + 1;
            const selected = answers[i];
            const questionResult = resultByQuestion?.get(questionNumber);
            return (
              <div
                key={questionNumber}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${
                  graded
                    ? questionResult?.is_correct
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-red-200 bg-red-50"
                    : "border-zinc-200"
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-white">
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
