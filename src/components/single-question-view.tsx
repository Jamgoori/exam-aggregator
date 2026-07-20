"use client";

import { useEffect, useRef } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  attachDrawing,
  DEFAULT_PEN_WIDTH,
  type DrawTool,
} from "@/components/pdf-canvas-viewer";

type QuestionAnswerState = {
  number: number;
  choiceCount: number;
  selected: number | null;
  onSelect: (choice: number) => void;
  questionResult: { selected_choice: number | null; is_correct: boolean } | null;
};

export function SingleQuestionView({
  questionIndex,
  totalQuestions,
  questions,
  images,
  prevIndex,
  nextIndex,
  onNavigate,
  tool,
  penColor,
  penWidth = DEFAULT_PEN_WIDTH,
  onClearReady,
  onSubmit,
  submitting,
  submitted,
  answeredCount,
  error,
}: {
  questionIndex: number;
  totalQuestions: number;
  // 공통지문 세트문제는 화면 하나에 여러 문제가 같이 보이므로, 답 선택 줄도
  // 세트에 속한 번호 수만큼 나온다(보통은 원소 1개).
  questions: QuestionAnswerState[];
  images: string[];
  prevIndex: number | null;
  nextIndex: number | null;
  onNavigate: (index: number) => void;
  tool: DrawTool;
  penColor: string;
  penWidth?: number;
  onClearReady?: (clear: () => void) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitted: boolean;
  answeredCount: number;
  error?: string | null;
}) {
  const firstNumber = questions[0]?.number ?? questionIndex + 1;
  const lastNumber = questions[questions.length - 1]?.number ?? firstNumber;
  const isLast = nextIndex === null;

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolRef = useRef(tool);
  const penColorRef = useRef(penColor);
  const penWidthRef = useRef(penWidth);
  // 문제별 보기는 전체보기의 확대/축소(zoom)와 무관하게 항상 원본 배율로 그린다.
  const zoomRef = useRef(1);

  useEffect(() => {
    toolRef.current = tool;
    if (canvasRef.current) {
      canvasRef.current.style.pointerEvents = tool === "move" ? "none" : "auto";
    }
  }, [tool]);

  useEffect(() => {
    penColorRef.current = penColor;
  }, [penColor]);

  useEffect(() => {
    penWidthRef.current = penWidth;
  }, [penWidth]);

  useEffect(() => {
    onClearReady?.(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
  }, [onClearReady]);

  // 문제 이미지 아래 남는 빈 공간까지 필기 캔버스로 덮어서, 문제와 답 고르는 부분
  // 사이를 오가며 자유롭게 메모할 수 있게 한다. 캔버스 크기는 문제 영역(이미지 높이
  // 또는 화면에 보이는 높이 중 더 큰 값)에 맞춰 리사이즈 옵저버로 계속 맞춰준다.
  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    const content = contentRef.current;
    const canvas = canvasRef.current;
    if (!scrollArea || !content || !canvas) return;

    attachDrawing(canvas, toolRef, penColorRef, zoomRef, penWidthRef);

    function syncSize() {
      const width = content!.clientWidth;
      const height = Math.max(content!.clientHeight, scrollArea!.clientHeight);
      // 필기 캔버스 버퍼를 화면 배율(dpr)만큼 더 촘촘하게 만들어야 고해상도 화면에서
      // 획이 흐릿하게 늘어나 보이지 않는다(attachDrawing이 좌표/선굵기에 같은 dpr을
      // 곱해 그린다). CSS 크기는 그대로 두고 내부 픽셀 버퍼만 dpr배로 키운다.
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas!.width !== pixelWidth || canvas!.height !== pixelHeight) {
        canvas!.width = pixelWidth;
        canvas!.height = pixelHeight;
        canvas!.style.width = `${width}px`;
        canvas!.style.height = `${height}px`;
      }
    }

    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(scrollArea);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // 문항을 넘기면 이미지가 통째로 바뀌어 좌표가 더 이상 의미 없으므로 필기를 지운다.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [questionIndex]);

  // 문제지 영역을 좌우로 쓸어넘기면 이전/다음 문제로 이동한다. 펜·지우개가 켜져
  // 있을 때는 획을 긋는 동작과 겹치므로 동작하지 않고(이동 모드에서만), 세로
  // 스크롤과 헷갈리지 않도록 가로 이동이 충분히 크고 우세할 때만 넘긴다.
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  function handleTouchStart(e: React.TouchEvent) {
    if (tool !== "move" || e.touches.length !== 1) {
      swipeStart.current = null;
      return;
    }
    swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  function handleTouchMove(e: React.TouchEvent) {
    // 도중에 손가락이 더 닿으면(핀치 등) 스와이프로 취급하지 않는다.
    if (e.touches.length > 1) swipeStart.current = null;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || tool !== "move") return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) {
      if (nextIndex !== null) onNavigate(nextIndex);
    } else if (prevIndex !== null) {
      onNavigate(prevIndex);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex shrink-0 items-center justify-center border-b border-zinc-100 bg-white px-4 py-2 dark:border-zinc-700 dark:bg-zinc-900">
        <div>
          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
            {firstNumber === lastNumber ? `${firstNumber}번` : `${firstNumber}~${lastNumber}번`}
          </span>
          <span className="text-sm text-zinc-400 dark:text-zinc-600"> / {totalQuestions}</span>
        </div>
        {/* 문제별 풀기 도중에도 언제든 전체 채점할 수 있도록 상단에 제출 버튼을 둔다. */}
        {!submitted && (
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="absolute right-3 rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
          >
            {submitting ? "채점 중..." : `제출 (${answeredCount}/${totalQuestions})`}
          </button>
        )}
      </div>

      <div
        ref={scrollAreaRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="min-h-0 flex-1 overflow-y-auto bg-zinc-100 px-4 py-4 dark:bg-zinc-800"
      >
        <div
          ref={contentRef}
          className="relative mx-auto flex min-h-full max-w-2xl flex-col gap-2 overflow-hidden rounded-lg border border-zinc-200 bg-white"
        >
          {images.length === 0 ? (
            <p className="pt-24 text-center text-sm text-zinc-400 dark:text-zinc-600">
              아직 이 문제의 이미지가 등록되지 않았어요.
            </p>
          ) : (
            images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={`${firstNumber}번 문제 이미지 ${i + 1}`}
                className="w-full"
              />
            ))
          )}
          <canvas
            ref={canvasRef}
            className="absolute left-0 top-0"
            style={{ touchAction: "none" }}
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900">
        {error && (
          <p className="mx-auto mb-2 max-w-2xl text-center text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <button
            type="button"
            aria-label="이전 문제"
            disabled={prevIndex === null}
            onClick={() => prevIndex !== null && onNavigate(prevIndex)}
            className="flex shrink-0 items-center justify-center rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <ChevronLeft size={22} />
          </button>

          {/* 세트문제는 번호마다 줄을 따로 두고, 줄 앞에 번호 배지를 붙여 어느
              문제의 선지인지 헷갈리지 않게 한다(줄이 하나뿐이면 배지도 숨긴다). */}
          <div className="flex flex-1 flex-col gap-2">
            {questions.map((q) => {
              const graded = submitted;
              return (
                <div key={q.number} className="flex items-center justify-center gap-2">
                  {questions.length > 1 && (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-white dark:bg-zinc-700">
                      {q.number}
                    </span>
                  )}
                  <div className="flex justify-center gap-2">
                    {Array.from({ length: q.choiceCount }, (_, c) => c + 1).map((choice) => {
                      const isSelected = q.selected === choice;
                      const isCorrectChoice =
                        graded && q.questionResult?.is_correct && isSelected;
                      const isWrongChoice =
                        graded && q.questionResult && !q.questionResult.is_correct && isSelected;
                      return (
                        <button
                          key={choice}
                          type="button"
                          disabled={graded}
                          onClick={() => q.onSelect(choice)}
                          className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                            isCorrectChoice
                              ? "bg-emerald-500 text-white"
                              : isWrongChoice
                                ? "bg-red-500 text-white"
                                : isSelected
                                  ? "bg-blue-600 text-white"
                                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                          } disabled:cursor-default`}
                        >
                          {choice}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 마지막 문제에서는 "다음" 대신 제출 버튼이 되어, 끝까지 푼 뒤 바로
              채점으로 이어지게 한다. 채점이 끝난 뒤에는(submitted) 비활성 다음 버튼. */}
          {isLast && !submitted ? (
            <button
              type="button"
              aria-label="제출하고 채점"
              disabled={submitting}
              onClick={onSubmit}
              className="flex shrink-0 items-center justify-center rounded-full bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
            >
              <Check size={22} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="다음 문제"
              disabled={nextIndex === null}
              onClick={() => nextIndex !== null && onNavigate(nextIndex)}
              className="flex shrink-0 items-center justify-center rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <ChevronRight size={22} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
