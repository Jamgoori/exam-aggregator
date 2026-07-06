"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { attachDrawing, type DrawTool } from "@/components/pdf-canvas-viewer";

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
  onClearReady,
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
  onClearReady?: (clear: () => void) => void;
}) {
  const questionNumber = questionIndex + 1;
  const graded = !!questionResult;

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toolRef = useRef(tool);
  const penColorRef = useRef(penColor);
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

    attachDrawing(canvas, toolRef, penColorRef, zoomRef);

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
      <div className="shrink-0 border-b border-zinc-100 bg-white px-4 py-2 text-center">
        <span className="text-sm font-bold text-zinc-800">{questionNumber}번</span>
        <span className="text-sm text-zinc-400"> / {totalQuestions}</span>
      </div>

      <div
        ref={scrollAreaRef}
        className="min-h-0 flex-1 overflow-y-auto bg-zinc-100 px-4 py-4"
      >
        <div
          ref={contentRef}
          className="relative mx-auto flex min-h-full max-w-2xl flex-col gap-2"
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
                className="w-full rounded-lg border border-zinc-200 bg-white"
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

          <button
            type="button"
            aria-label="다음 문제"
            disabled={questionIndex === totalQuestions - 1}
            onClick={() => onNavigate(questionIndex + 1)}
            className="flex shrink-0 items-center justify-center rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}
