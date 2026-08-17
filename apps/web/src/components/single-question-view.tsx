"use client";

import { useEffect, useRef } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { DEFAULT_PEN_WIDTH, type DrawTool } from "@/components/pdf-canvas-viewer";
import {
  useFitContentWidth,
  useQuestionDrawing,
  useSwipeNavigation,
} from "@/components/question-view-gestures";

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
  zoom = 1,
  onPinchZoom,
  report,
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
  zoom?: number;
  // 두 손가락 핀치로 확대/축소할 때 직전 대비 배율(예: 1.02)을 부모(zoom 상태 보유)에
  // 올려보내는 콜백. 손(이동) 모드에서는 스크롤 영역 터치로, 펜/지우개 모드에서는
  // 캔버스 pointer로 잡아 같은 콜백을 호출한다.
  onPinchZoom?: (factor: number) => void;
  // 모바일 헤더의 문항 번호 옆에 붙는 오류 신고 버튼. lg 이상은 이 헤더 자체가 숨고
  // cbt-solver의 탭 줄에 별도로 붙으므로, 여기서는 lg 미만 헤더에만 쓰인다.
  report?: React.ReactNode;
}) {
  const firstNumber = questions[0]?.number ?? questionIndex + 1;
  const lastNumber = questions[questions.length - 1]?.number ?? firstNumber;
  const isLast = nextIndex === null;

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { contentWidth, handleImageLoad } = useFitContentWidth({
    scrollAreaRef,
    itemKey: questionIndex,
    imageCount: images.length,
    zoom,
  });

  // 필기는 문항별로 기록해둔다 — 다음 문제로 넘어갔다 돌아와도, 확대/축소로 캔버스
  // 크기가 바뀌어도 그 문항에 남긴 필기가 그대로 다시 그려진다.
  const { clearCurrent } = useQuestionDrawing({
    scrollAreaRef,
    contentRef,
    canvasRef,
    itemKey: questionIndex,
    tool,
    penColor,
    penWidth,
    onPinchZoom,
  });

  useEffect(() => {
    onClearReady?.(clearCurrent);
  }, [onClearReady, clearCurrent]);

  const swipeHandlers = useSwipeNavigation({
    tool,
    onPrev: () => prevIndex !== null && onNavigate(prevIndex),
    onNext: () => nextIndex !== null && onNavigate(nextIndex),
    onPinchZoom,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* lg(태블릿 가로·데스크톱)에서는 이 번호·제출 줄을 상단 탭 줄로 옮겨 세로
          공간을 아끼므로 여기서는 숨긴다. 폭이 좁은 모바일에서는 탭 줄에 넣으면
          넘쳐서, 모바일 한정으로 이 자체 헤더를 그대로 쓴다. */}
      <div className="relative flex shrink-0 items-center justify-center border-b border-zinc-100 bg-white px-4 py-2 lg:hidden dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex items-center gap-1">
          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">
            {firstNumber === lastNumber ? `${firstNumber}번` : `${firstNumber}~${lastNumber}번`}
          </span>
          <span className="text-sm text-zinc-400 dark:text-zinc-600"> / {totalQuestions}</span>
          {report}
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
        {...swipeHandlers}
        // pan-y로 두면 세로 스크롤(한 손가락)은 그대로 두고 브라우저 기본 핀치줌만
        // 꺼져서, 두 손가락 핀치를 위 핸들러가 문제 확대/축소로 쓸 수 있다.
        style={{ touchAction: "pan-y" }}
        className="min-h-0 flex-1 overflow-y-auto bg-zinc-100 px-4 py-4 dark:bg-zinc-800"
      >
        <div
          ref={contentRef}
          style={{ maxWidth: `${contentWidth}px` }}
          className="relative mx-auto flex min-h-full w-full flex-col gap-2 overflow-hidden rounded-lg border border-zinc-200 bg-white"
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
                onLoad={(e) => handleImageLoad(i, e.currentTarget)}
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
