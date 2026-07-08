"use client";

import { useEffect, useRef } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import {
  attachDrawing,
  DEFAULT_PEN_WIDTH,
  type DrawTool,
} from "@/components/pdf-canvas-viewer";

export function SingleQuestionView({
  questionIndex,
  totalQuestions,
  choiceCount,
  images,
  selected,
  onSelect,
  onNavigate,
  questionResult,
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
  choiceCount: number;
  images: string[];
  selected: number | null;
  onSelect: (choice: number) => void;
  onNavigate: (index: number) => void;
  questionResult: { selected_choice: number | null; is_correct: boolean } | null;
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
  const questionNumber = questionIndex + 1;
  const graded = !!questionResult;
  const isLast = questionIndex === totalQuestions - 1;

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
      if (canvas!.width !== width || canvas!.height !== height) {
        canvas!.width = width;
        canvas!.height = height;
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex shrink-0 items-center justify-center border-b border-zinc-100 bg-white px-4 py-2">
        <div>
          <span className="text-sm font-bold text-zinc-800">{questionNumber}번</span>
          <span className="text-sm text-zinc-400"> / {totalQuestions}</span>
        </div>
        {/* 문제별 풀기 도중에도 언제든 전체 채점할 수 있도록 상단에 제출 버튼을 둔다. */}
        {!submitted && (
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="absolute right-3 rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {submitting ? "채점 중..." : `제출 (${answeredCount}/${totalQuestions})`}
          </button>
        )}
      </div>

      <div
        ref={scrollAreaRef}
        className="min-h-0 flex-1 overflow-y-auto bg-zinc-100 px-4 py-4"
      >
        <div
          ref={contentRef}
          className="relative mx-auto flex min-h-full max-w-2xl flex-col gap-2 overflow-hidden rounded-lg border border-zinc-200 bg-white"
        >
          {images.length === 0 ? (
            <p className="pt-24 text-center text-sm text-zinc-400">
              아직 이 문제의 이미지가 등록되지 않았어요.
            </p>
          ) : (
            images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={`${questionNumber}번 문제 이미지 ${i + 1}`}
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

      <div className="shrink-0 border-t border-zinc-200 bg-white px-3 py-3">
        {error && (
          <p className="mx-auto mb-2 max-w-2xl text-center text-xs text-red-600">
            {error}
          </p>
        )}
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <button
            type="button"
            aria-label="이전 문제"
            disabled={questionIndex === 0}
            onClick={() => onNavigate(questionIndex - 1)}
            className="flex shrink-0 items-center justify-center rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft size={22} />
          </button>

          <div className="flex flex-1 justify-center gap-2">
            {Array.from({ length: choiceCount }, (_, c) => c + 1).map((choice) => {
              const isSelected = selected === choice;
              const isCorrectChoice = graded && questionResult?.is_correct && isSelected;
              const isWrongChoice = graded && !questionResult?.is_correct && isSelected;
              return (
                <button
                  key={choice}
                  type="button"
                  disabled={graded}
                  onClick={() => onSelect(choice)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                    isCorrectChoice
                      ? "bg-emerald-500 text-white"
                      : isWrongChoice
                        ? "bg-red-500 text-white"
                        : isSelected
                          ? "bg-blue-600 text-white"
                          : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                  } disabled:cursor-default`}
                >
                  {choice}
                </button>
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
              className="flex shrink-0 items-center justify-center rounded-full bg-blue-600 p-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
            >
              <Check size={22} />
            </button>
          ) : (
            <button
              type="button"
              aria-label="다음 문제"
              disabled={isLast}
              onClick={() => onNavigate(questionIndex + 1)}
              className="flex shrink-0 items-center justify-center rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={22} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
