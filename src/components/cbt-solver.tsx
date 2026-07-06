"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ChevronLeft,
  Clock,
  Eraser,
  Hand,
  PenLine,
  Trash2,
  Trophy,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { submitCbtAttempt, type CbtSubmitResult } from "@/app/papers/actions";
import type { DrawTool } from "@/components/pdf-canvas-viewer";
import { SingleQuestionView } from "@/components/single-question-view";
import { formatDuration } from "@/lib/format";

// pdf.js는 브라우저 전용 API(Worker, canvas 등)에 의존해서 서버에서 미리 렌더링하면
// 안 되므로, 이 컴포넌트는 클라이언트에서만 로드한다.
const PdfCanvasViewer = dynamic(
  () => import("@/components/pdf-canvas-viewer").then((m) => m.PdfCanvasViewer),
  { ssr: false },
);

const PEN_COLORS = ["#111827", "#ef4444", "#2563eb"];

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function CbtSolver({
  paperId,
  paperTitle,
  fileUrl,
  totalQuestions,
  choiceCount,
  questionImages = {},
  questionChoiceCounts = {},
}: {
  paperId: string;
  paperTitle: string;
  fileUrl: string;
  totalQuestions: number;
  choiceCount: number;
  questionImages?: Record<number, string[]>;
  questionChoiceCounts?: Record<number, number>;
}) {
  const [answers, setAnswers] = useState<(number | null)[]>(
    Array(totalQuestions).fill(null),
  );
  const [omrOpen, setOmrOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const [result, setResult] = useState<CbtSubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const startedAtRef = useRef(0);
  const [tool, setTool] = useState<DrawTool>("move");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const clearDrawingRef = useRef<() => void>(() => {});
  const clearSingleDrawingRef = useRef<() => void>(() => {});
  const [zoom, setZoom] = useState(1);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  const hasQuestionImages = Object.keys(questionImages).length > 0;
  const [viewMode, setViewMode] = useState<"full" | "single">("full");
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // 페이지에 들어오면 곧바로 재기 시작하는 대신 5초 카운트다운을 보여주고, 그
  // 카운트다운이 끝나는 시점부터 실제 풀이 시간을 잰다.
  useEffect(() => {
    if (countdown <= 0) {
      startedAtRef.current = Date.now();
      return;
    }
    const timeout = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timeout);
  }, [countdown]);

  const registerClearDrawing = useCallback((clear: () => void) => {
    clearDrawingRef.current = clear;
  }, []);

  const registerClearSingleDrawing = useCallback((clear: () => void) => {
    clearSingleDrawingRef.current = clear;
  }, []);

  function clearDrawing() {
    if (viewMode === "full") {
      clearDrawingRef.current();
    } else {
      clearSingleDrawingRef.current();
    }
  }

  // 전체보기(PDF)와 문제별 보기는 서로 다른 캔버스(좌표계)에 필기를 남기므로, 서로
  // 오갈 때는 미리 경고하고 필기를 지운다.
  function switchViewMode(mode: "full" | "single") {
    if (mode === viewMode) return;
    if (viewMode === "full" && mode === "single") {
      if (
        !window.confirm(
          "문제별 보기로 바꾸면 전체보기에 그린 필기 내용이 모두 지워져요. 계속할까요?",
        )
      ) {
        return;
      }
      clearDrawingRef.current();
    }
    if (viewMode === "single" && mode === "full") {
      if (
        !window.confirm(
          "전체보기로 바꾸면 문제별 보기에 그린 필기 내용이 모두 지워져요. 계속할까요?",
        )
      ) {
        return;
      }
    }
    setViewMode(mode);
  }

  function zoomIn() {
    setZoom((z) => clampZoom(Math.round((z + ZOOM_STEP) * 100) / 100));
  }

  function zoomOut() {
    setZoom((z) => clampZoom(Math.round((z - ZOOM_STEP) * 100) / 100));
  }

  // 트랙패드 핀치줌/Ctrl+휠은 브라우저 기본 동작으로는 페이지 전체(시험지+OMR
  // 패널)를 함께 확대해버린다. 시험지 영역에서만 이 이벤트를 가로채 브라우저 확대를
  // 막고, 대신 PDF 뷰어에만 걸리는 자체 줌 상태를 조절한다. React의 onWheel은
  // 리스너가 passive로 등록돼 preventDefault가 무시되므로 네이티브로 직접 등록한다.
  useEffect(() => {
    const el = pdfWrapperRef.current;
    if (!el) return;
    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z - e.deltaY * 0.0015));
    }
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  useEffect(() => {
    if (result || countdown > 0) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [result, countdown]);

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
    setElapsedSeconds(0);
    setCountdown(5);
  }

  const resultByQuestion = new Map(
    (result?.questionResults ?? []).map((q) => [q.question_number, q]),
  );

  return (
    // SiteHeaderGate가 lg 이상에서는 전역 사이트 헤더(약 65px)를 그대로 보여주는데,
    // 100dvh는 그 헤더를 포함한 뷰포트 전체 높이라서 그만큼을 빼주지 않으면
    // 화면 하단(OMR 제출 버튼 등)이 잘린다. lg 미만은 헤더가 아예 없으니 그대로 둔다.
    <div className="flex h-[100dvh] flex-col lg:h-[calc(100dvh-65px)]">
      {/* 헤더/탭/펜 색상 바를 하나의 그룹으로 묶어서, 각 줄마다 구분선이 겹겹이
          쌓이지 않게 내부 구분선 없이 콘텐츠와 닿는 맨 아래에만 선을 둔다. */}
      <div className="shrink-0 border-b border-zinc-200 bg-white">
        <header>
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2">
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
                {countdown > 0 ? `${countdown}초 후 시작` : formatDuration(elapsedSeconds)}
              </div>
              <div className="hidden items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 lg:flex">
                <button
                  type="button"
                  onClick={zoomOut}
                  disabled={zoom <= MIN_ZOOM}
                  aria-label="시험지 축소"
                  className="flex items-center justify-center rounded-md p-1.5 text-zinc-600 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <ZoomOut size={18} />
                </button>
                <span className="w-10 text-center text-xs font-medium text-zinc-500">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={zoomIn}
                  disabled={zoom >= MAX_ZOOM}
                  aria-label="시험지 확대"
                  className="flex items-center justify-center rounded-md p-1.5 text-zinc-600 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <ZoomIn size={18} />
                </button>
              </div>
              <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5">
                <button
                  type="button"
                  onClick={() => setTool("move")}
                  aria-label="화면 이동"
                  aria-pressed={tool === "move"}
                  className={`flex items-center justify-center rounded-md p-1.5 ${
                    tool === "move"
                      ? "bg-blue-600 text-white"
                      : "text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  <Hand size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setTool("pen")}
                  aria-label="펜"
                  aria-pressed={tool === "pen"}
                  className={`flex items-center justify-center rounded-md p-1.5 ${
                    tool === "pen"
                      ? "bg-blue-600 text-white"
                      : "text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  <PenLine size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setTool("eraser")}
                  aria-label="지우개"
                  aria-pressed={tool === "eraser"}
                  className={`flex items-center justify-center rounded-md p-1.5 ${
                    tool === "eraser"
                      ? "bg-blue-600 text-white"
                      : "text-zinc-600 hover:bg-zinc-200"
                  }`}
                >
                  <Eraser size={18} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setOmrOpen(true)}
                className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 lg:hidden"
              >
                답안 입력
              </button>
            </div>
          </div>
        </header>
  
        <div>
          <div className="mx-auto flex max-w-7xl items-center gap-1 px-4 py-1.5">
            <button
              type="button"
              onClick={() => switchViewMode("full")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                viewMode === "full"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-500 hover:bg-zinc-100"
              }`}
            >
              전체보기
            </button>
            <button
              type="button"
              onClick={() => switchViewMode("single")}
              disabled={!hasQuestionImages}
              title={
                hasQuestionImages ? undefined : "문항별 이미지가 아직 등록되지 않았어요"
              }
              className={`rounded-full px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                viewMode === "single"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-500 hover:bg-zinc-100"
              }`}
            >
              문제별 풀기
            </button>
          </div>
        </div>
  
        {tool !== "move" && (
          <div>
            <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5">
              {tool === "pen" &&
                PEN_COLORS.map((color) => (
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
              {tool === "eraser" && (
                <p className="text-xs text-zinc-400">
                  드래그한 부분만 지워져요
                </p>
              )}
              <button
                type="button"
                onClick={clearDrawing}
                className="ml-auto flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700"
              >
                <Trash2 size={14} />
                전체 지우기
              </button>
            </div>
          </div>
        )}
      </div>

      {/* PDF는 파싱/렌더링 비용이 커서 탭을 바꿔도 언마운트하지 않고 숨기기만 한다
          (다시 보일 때마다 처음부터 다시 불러오는 것을 피하기 위함). */}
      <div
        className={`min-h-0 flex-1 justify-center ${viewMode === "full" ? "flex" : "hidden"}`}
      >
        <div className="flex min-h-0 w-full max-w-7xl">
          <div ref={pdfWrapperRef} className="relative min-w-0 flex-1">
            <PdfCanvasViewer
              fileUrl={fileUrl}
              tool={tool}
              penColor={penColor}
              zoom={zoom}
              onClearReady={registerClearDrawing}
            />
          </div>

          <OmrPanel
            className="hidden w-[240px] shrink-0 flex-col border-l border-zinc-200 lg:flex"
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

      {viewMode === "single" && (
        <SingleQuestionView
          questionIndex={currentQuestionIndex}
          totalQuestions={totalQuestions}
          choiceCount={questionChoiceCounts[currentQuestionIndex + 1] ?? choiceCount}
          images={questionImages[currentQuestionIndex + 1] ?? []}
          selected={answers[currentQuestionIndex]}
          onSelect={(choice) => selectChoice(currentQuestionIndex, choice)}
          onNavigate={setCurrentQuestionIndex}
          questionResult={
            result ? (resultByQuestion.get(currentQuestionIndex + 1) ?? null) : null
          }
          tool={tool}
          penColor={penColor}
          onClearReady={registerClearSingleDrawing}
        />
      )}

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
              <h2 className="text-sm font-semibold text-zinc-700">답안 입력</h2>
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
        <div className="grid grid-cols-1 gap-1.5">
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
