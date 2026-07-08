"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ChevronDown,
  ChevronLeft,
  Clock,
  Eraser,
  Hand,
  Lock,
  LockOpen,
  PenLine,
  Trash2,
  Trophy,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { setDefaultCbtViewMode } from "@/app/actions";
import {
  startCbtAttempt,
  submitCbtAttempt,
  type CbtSubmitResult,
} from "@/app/papers/actions";
import {
  DEFAULT_PEN_WIDTH,
  PEN_WIDTH_PRESETS,
  type DrawTool,
} from "@/components/pdf-canvas-viewer";
import { SingleQuestionView } from "@/components/single-question-view";
import { MIN_ATTEMPT_SECONDS } from "@/lib/cbt-attempt";
import { formatDuration } from "@/lib/format";

// pdf.js는 브라우저 전용 API(Worker, canvas 등)에 의존해서 서버에서 미리 렌더링하면
// 안 되므로, 이 컴포넌트는 클라이언트에서만 로드한다.
const PdfCanvasViewer = dynamic(
  () => import("@/components/pdf-canvas-viewer").then((m) => m.PdfCanvasViewer),
  { ssr: false },
);

const PEN_COLORS = ["#111827", "#ef4444", "#2563eb"];

// 팔레트 트리거 아이콘의 무지개 링(아직 고른 색이 없을 때는 링 없이 이 그러데이션
// 자체를 꽉 채워서 "눌러서 색을 골라보라"는 신호로 쓴다).
const RAINBOW_GRADIENT =
  "conic-gradient(from 0deg, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #6366f1, #ec4899, #ef4444)";

// 검빨파 기본 3색 외에 팔레트에서 바로 고를 수 있는 색상들. 무지개 색상환을 고루
// 훑도록 골랐고, 맨 끝의 "+"로 그 외의 임의의 색도 직접 지정할 수 있다.
const PALETTE_PRESETS = [
  "#f97316",
  "#eab308",
  "#84cc16",
  "#16a34a",
  "#0d9488",
  "#0ea5e9",
  "#4f46e5",
  "#7c3aed",
  "#a855f7",
  "#ec4899",
  "#f43f5e",
  "#78350f",
  "#1e3a8a",
  "#6b7280",
];

// 팔레트의 색상환+명도 슬라이더에서 고른 값을 hex로 바꾼다. 네이티브 OS 색상
// 선택창(input type=color)은 기기마다 생김새가 완전히 달라 사이트 디자인과 안
// 어울려서, 그 자리를 이 자체 제작 피커로 대신한다.
function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// 자물쇠 버튼 안내 말풍선을 "다시 보지 않기"로 닫으면 이 기기/브라우저에 그 사실을
// 남겨두는 키. 계정(user_metadata)이 아니라 로컬에만 남기는 이유는, 이건 실제 설정값이
// 아니라 UI를 처음 보는 사람에게만 필요한 안내라서 서버 왕복까지 갈 필요가 없어서다.
const LOCK_HINT_STORAGE_KEY = "cbt-lock-hint-dismissed";

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
  defaultViewMode = null,
}: {
  paperId: string;
  paperTitle: string;
  fileUrl: string;
  totalQuestions: number;
  choiceCount: number;
  questionImages?: Record<number, string[]>;
  questionChoiceCounts?: Record<number, number>;
  // 계정에 명시적으로 저장된 시작 모드. 자물쇠를 한 번도 안 눌러본 계정은 null이고,
  // 그 경우 전체보기로 시작하되 자물쇠는 "잠기지 않은" 상태로 보여준다.
  defaultViewMode?: "full" | "single" | null;
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
  // 기본 3색 외에 팔레트에서 고른 색. 아직 한 번도 안 골랐으면 null이고, 트리거
  // 아이콘은 그동안 무지개색 그대로 보여준다(첫 사용자에게 "여기서 더 고를 수
  // 있다"는 신호). 한 번 고르고 나면 그 색을 계속 기억해서 다시 보여준다.
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_WIDTH);
  const [widthMenuOpen, setWidthMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const widthMenuRef = useRef<HTMLDivElement>(null);
  const paletteMenuRef = useRef<HTMLDivElement>(null);
  // 팔레트의 색상환(채도/명도 사각형 + 색상 슬라이더) 상태. customColor는 여기서
  // 나온 hex 결과값만 반영하고, 되돌아왔을 때 손잡이 위치를 이어가려고 hue/채도/
  // 명도를 따로 들고 있는다.
  const [pickerHue, setPickerHue] = useState(265);
  const [pickerSat, setPickerSat] = useState(0.7);
  const [pickerVal, setPickerVal] = useState(0.85);
  const svSquareRef = useRef<HTMLDivElement>(null);
  const hueSliderRef = useRef<HTMLDivElement>(null);

  function applyPickerColor(hue: number, sat: number, val: number) {
    const hex = hsvToHex(hue, sat, val);
    setCustomColor(hex);
    setPenColor(hex);
  }

  function updateFromSquare(clientX: number, clientY: number) {
    const el = svSquareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const nextSat = x;
    const nextVal = 1 - y;
    setPickerSat(nextSat);
    setPickerVal(nextVal);
    applyPickerColor(pickerHue, nextSat, nextVal);
  }

  function updateFromHueSlider(clientX: number) {
    const el = hueSliderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const nextHue = x * 360;
    setPickerHue(nextHue);
    applyPickerColor(nextHue, pickerSat, pickerVal);
  }

  // 굵기/팔레트 드롭다운이 열려 있을 때 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!widthMenuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (widthMenuRef.current && !widthMenuRef.current.contains(e.target as Node)) {
        setWidthMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [widthMenuOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (paletteMenuRef.current && !paletteMenuRef.current.contains(e.target as Node)) {
        setPaletteOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [paletteOpen]);
  const clearDrawingRef = useRef<() => void>(() => {});
  const clearSingleDrawingRef = useRef<() => void>(() => {});
  const [zoom, setZoom] = useState(1);
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  const hasQuestionImages = Object.keys(questionImages).length > 0;
  // 사이트 기본값은 "문제별 풀기"다. 계정에 "전체보기"가 명시적으로 잠겨 있으면
  // 그걸 따르고, 그 외에는(잠긴 게 없거나 "문제별 풀기"로 잠겨 있으면) 문제별
  // 풀기로 시작한다. 다만 이 문제지에 문항별 이미지가 아직 없으면 그 탭 자체가
  // 막혀 있으니 전체보기로 시작한다.
  const [viewMode, setViewMode] = useState<"full" | "single">(
    defaultViewMode === "full" ? "full" : hasQuestionImages ? "single" : "full",
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [savedDefaultViewMode, setSavedDefaultViewMode] = useState(defaultViewMode);
  const [isSavingDefault, startSavingDefault] = useTransition();
  const [lockHintVisible, setLockHintVisible] = useState(false);
  const [dontShowLockHint, setDontShowLockHint] = useState(false);

  // 자물쇠 버튼은 아이콘만 봐서는 기능을 짐작하기 어려워서, 처음 들어왔을 때 한 번
  // 말풍선으로 짚어준다. 로딩 직후 다른 UI와 뒤섞여 나타나지 않게 살짝 지연을 둔다.
  useEffect(() => {
    if (localStorage.getItem(LOCK_HINT_STORAGE_KEY)) return;
    const timeout = setTimeout(() => setLockHintVisible(true), 600);
    return () => clearTimeout(timeout);
  }, []);

  function dismissLockHint(persist: boolean) {
    setLockHintVisible(false);
    if (persist) localStorage.setItem(LOCK_HINT_STORAGE_KEY, "1");
  }

  // 페이지에 들어오면 곧바로 재기 시작하는 대신 5초 카운트다운을 보여주고, 그
  // 카운트다운이 끝나는 시점부터 실제 풀이 시간을 잰다. 동시에 서버에도 시작 시각을
  // 기록해서(startCbtAttempt), 채점 시 최소 응시시간(3분)을 클라이언트가 조작할 수
  // 없는 기준으로 검증할 수 있게 한다.
  useEffect(() => {
    if (countdown <= 0) {
      startedAtRef.current = Date.now();
      startCbtAttempt(paperId);
      return;
    }
    const timeout = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timeout);
  }, [countdown, paperId]);

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

  // 지금 보고 있는 모드가 이미 저장된 기본 시작 모드와 같으면(자물쇠가 잠긴 상태)
  // "켜져 있다"는 뜻이다.
  const isDefaultViewModeLocked = savedDefaultViewMode === viewMode;

  // 자물쇠 아이콘: 지금 보고 있는 모드(전체보기/문제별 풀기)를 계정의 기본 시작
  // 모드로 저장하는 토글이다. 이미 잠겨 있는 상태에서 다시 누르면 저장된 기본값을
  // 지워서(null) 잠금을 해제한다 — 그냥 같은 값을 다시 저장만 하면 잠긴 채로
  // 아무 변화도 안 보여서 껐는지 켰는지 구분이 안 됐다.
  function handleToggleDefaultViewMode() {
    if (isSavingDefault) return;
    // 실제로 눌러봤다는 건 이미 기능을 파악했다는 뜻이므로, 체크 여부와 무관하게
    // 안내를 다시 띄우지 않는다.
    if (lockHintVisible) dismissLockHint(true);
    const nextDefault = isDefaultViewModeLocked ? null : viewMode;
    startSavingDefault(async () => {
      const res = await setDefaultCbtViewMode(nextDefault);
      if (!res.error) setSavedDefaultViewMode(nextDefault);
    });
  }

  function zoomIn() {
    setZoom((z) => clampZoom(Math.round((z + ZOOM_STEP) * 100) / 100));
  }

  function zoomOut() {
    setZoom((z) => clampZoom(Math.round((z - ZOOM_STEP) * 100) / 100));
  }

  // 펜/지우개 도구 중에도 모바일에서 두 손가락으로 짚으면(핀치) 필기 대신 이
  // 배율을 조절한다. factor는 PdfCanvasViewer가 넘겨주는, 직전 대비 손가락 간격
  // 변화 비율이라 그대로 곱해서 반영한다.
  function handlePinchZoom(factor: number) {
    setZoom((z) => clampZoom(Math.round(z * factor * 100) / 100));
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

  // 저장 버튼이 따로 없어서, 채점 전에 페이지를 벗어나면 지금까지 고른 답이 그냥
  // 사라진다. 새로고침/닫기/주소창 이동은 beforeunload로, 링크 클릭이나(사이트
  // 헤더의 로고·마이페이지 링크 포함) 로그아웃 폼 제출은 클릭/제출을 가로채 확인
  // 창을 띄우는 방식으로 막는다. 채점이 끝나면(result) 더 잃을 게 없으니 풀어준다.
  useEffect(() => {
    if (result) return;

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }

    function confirmLeave(e: Event) {
      if (
        !window.confirm(
          "지금 나가면 저장되지 않고 풀이 중인 내용이 모두 사라져요. 그래도 나갈까요?",
        )
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }

    function handleClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a");
      if (!anchor || anchor.target === "_blank") return;
      confirmLeave(e);
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("submit", confirmLeave, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("submit", confirmLeave, true);
    };
  }, [result]);

  useEffect(() => {
    if (result || countdown > 0) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [result, countdown]);

  // 문제별 보기에서 다음/이전 문항으로 넘어갈 때마다 이미지를 새로 받느라, 상단 번호는
  // 바로 바뀌는데 문제 사진은 뒤늦게 뜨는 문제가 있었다. 문제별 보기를 처음 켜는
  // 순간 모든 문항 이미지를 미리 브라우저 캐시에 받아둬서, 이후 이동은 캐시에서 바로
  // 그려지게 한다(이미 받아둔 이미지는 브라우저가 재요청하지 않는다).
  const preloadedImagesRef = useRef(false);
  useEffect(() => {
    if (viewMode !== "single" || preloadedImagesRef.current) return;
    preloadedImagesRef.current = true;
    for (const images of Object.values(questionImages)) {
      for (const src of images) {
        const img = new Image();
        img.src = src;
      }
    }
  }, [viewMode, questionImages]);

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
    // 실제 최소 응시시간 검증은 서버가 하지만, 3분이 안 지났으면 서버까지 왕복하지
    // 않고 바로 알려준다 (서버 기준 시각과는 별개로 클라이언트 안내용).
    if (Date.now() - startedAtRef.current < MIN_ATTEMPT_SECONDS * 1000) {
      alert("최소 3분은 풀어야 채점할 수 있어요. 조금만 더 풀어보세요!");
      return;
    }
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
              onClick={() => switchViewMode("single")}
              disabled={!hasQuestionImages}
              title={
                hasQuestionImages ? undefined : "문항별 이미지가 아직 등록되지 않았어요"
              }
              className={`rounded-full px-3 py-1 text-[15px] font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
                viewMode === "single"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-500 hover:bg-zinc-100"
              }`}
            >
              문제별 풀기
            </button>
            <button
              type="button"
              onClick={() => switchViewMode("full")}
              className={`rounded-full px-3 py-1 text-[15px] font-medium ${
                viewMode === "full"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-500 hover:bg-zinc-100"
              }`}
            >
              전체보기
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={handleToggleDefaultViewMode}
                disabled={isSavingDefault}
                aria-pressed={isDefaultViewModeLocked}
                aria-label={
                  isDefaultViewModeLocked
                    ? "저장된 시작 모드 해제하기"
                    : "이 모드를 시작 모드로 저장"
                }
                title={
                  isDefaultViewModeLocked
                    ? "다음 온라인 응시부터 이 모드로 시작해요. 누르면 해제해요"
                    : "누르면 다음 온라인 응시부터 이 모드로 시작해요"
                }
                className={`flex items-center justify-center rounded-full p-1.5 disabled:opacity-50 ${
                  isDefaultViewModeLocked
                    ? "bg-blue-600 text-white"
                    : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
                }`}
              >
                {isDefaultViewModeLocked ? (
                  <Lock size={16} />
                ) : (
                  <LockOpen size={16} />
                )}
              </button>

              {lockHintVisible && (
                <div className="absolute left-1/2 top-full z-30 mt-2 w-56 -translate-x-1/2 rounded-xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-600/30">
                  <div className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-blue-600" />
                  <button
                    type="button"
                    aria-label="안내 닫기"
                    onClick={() => dismissLockHint(dontShowLockHint)}
                    className="absolute right-2 top-2 text-blue-200 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                  <p className="pr-4 text-xs font-medium leading-relaxed">
                    자물쇠를 누르면 이 모드를 기본값으로 저장해요. 다음
                    응시부터 바로 이 화면으로 열려요.
                  </p>
                  <label className="mt-2 flex items-center gap-1.5 text-[11px] text-blue-100">
                    <input
                      type="checkbox"
                      checked={dontShowLockHint}
                      onChange={(e) => setDontShowLockHint(e.target.checked)}
                      className="h-3 w-3 accent-white"
                    />
                    다시 보지 않기
                  </label>
                </div>
              )}
            </div>
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
                    className={`h-5 w-5 shrink-0 rounded-full ${
                      penColor === color ? "ring-2 ring-offset-1 ring-zinc-400" : ""
                    }`}
                  />
                ))}
              {tool === "pen" && (
                // 기본 3색 외의 색은 여기 팔레트에서 고른다. 아직 안 골랐으면 트리거
                // 아이콘 전체가 무지개색이라 "눌러서 더 골라보라"는 신호가 되고, 한 번
                // 고르고 나면 그 색을 채운 원 + 무지개 테두리로 바뀐다(그림 3 참고).
                <div ref={paletteMenuRef} className="relative shrink-0">
                  <button
                    type="button"
                    aria-label="펜 팔레트 색상 선택"
                    aria-expanded={paletteOpen}
                    onClick={() => setPaletteOpen((v) => !v)}
                    className="flex h-5 w-5 items-center justify-center rounded-full"
                  >
                    {customColor ? (
                      <span
                        style={{ background: RAINBOW_GRADIENT }}
                        className={`flex h-5 w-5 items-center justify-center rounded-full p-[2px] ${
                          penColor === customColor
                            ? "ring-2 ring-offset-1 ring-zinc-400"
                            : ""
                        }`}
                      >
                        <span
                          style={{ backgroundColor: customColor }}
                          className="h-full w-full rounded-full border border-white"
                        />
                      </span>
                    ) : (
                      <span
                        style={{ background: RAINBOW_GRADIENT }}
                        className="h-5 w-5 rounded-full"
                      />
                    )}
                  </button>
                  {paletteOpen && (
                    <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg">
                      <div className="grid grid-cols-7 gap-1.5">
                        {PALETTE_PRESETS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            aria-label="팔레트 색상"
                            aria-pressed={customColor === color}
                            onClick={() => {
                              setCustomColor(color);
                              setPenColor(color);
                              setPaletteOpen(false);
                            }}
                            style={{ backgroundColor: color }}
                            className={`h-5 w-5 rounded-full ${
                              customColor === color
                                ? "ring-2 ring-offset-1 ring-zinc-400"
                                : ""
                            }`}
                          />
                        ))}
                      </div>

                      {/* 네이티브 OS 색상 선택창은 기기마다 생김새가 완전히 달라
                          사이트 디자인과 어울리지 않아서, 채도/명도 사각형 + 색상
                          슬라이더를 직접 구현했다. Pointer Capture로 손가락이
                          사각형/슬라이더 밖으로 나가도 계속 그 조작으로 잡아둔다. */}
                      <div
                        ref={svSquareRef}
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          updateFromSquare(e.clientX, e.clientY);
                        }}
                        onPointerMove={(e) => {
                          if (e.buttons !== 1) return;
                          updateFromSquare(e.clientX, e.clientY);
                        }}
                        style={{
                          backgroundColor: `hsl(${pickerHue}, 100%, 50%)`,
                          backgroundImage:
                            "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
                        }}
                        className="relative mt-3 h-28 w-full touch-none rounded-lg"
                      >
                        <span
                          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                          style={{
                            left: `${pickerSat * 100}%`,
                            top: `${(1 - pickerVal) * 100}%`,
                            backgroundColor: customColor ?? PEN_COLORS[0],
                          }}
                        />
                      </div>

                      <div
                        ref={hueSliderRef}
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          updateFromHueSlider(e.clientX);
                        }}
                        onPointerMove={(e) => {
                          if (e.buttons !== 1) return;
                          updateFromHueSlider(e.clientX);
                        }}
                        style={{
                          background:
                            "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
                        }}
                        className="relative mt-3 h-3 w-full touch-none rounded-full"
                      >
                        <span
                          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                          style={{
                            left: `${(pickerHue / 360) * 100}%`,
                            backgroundColor: `hsl(${pickerHue}, 100%, 50%)`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
              {tool === "pen" && (
                <div
                  ref={widthMenuRef}
                  className="relative shrink-0 border-l border-zinc-200 pl-2"
                >
                  <button
                    type="button"
                    aria-label="펜 굵기 선택"
                    aria-expanded={widthMenuOpen}
                    onClick={() => setWidthMenuOpen((v) => !v)}
                    className="flex h-6 items-center gap-0.5 rounded-full px-1 hover:bg-zinc-100"
                  >
                    <span
                      className="rounded-full bg-zinc-500"
                      style={{ width: penWidth + 2, height: penWidth + 2 }}
                    />
                    <ChevronDown
                      size={12}
                      className={`text-zinc-400 transition-transform ${widthMenuOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                  {widthMenuOpen && (
                    <div className="absolute left-1/2 top-full z-30 mt-1 flex -translate-x-1/2 flex-col items-center gap-1 rounded-full border border-zinc-200 bg-white p-1.5 shadow-lg">
                      {PEN_WIDTH_PRESETS.map((width) => (
                        <button
                          key={width}
                          type="button"
                          aria-label={`펜 굵기 ${width}`}
                          aria-pressed={penWidth === width}
                          onClick={() => {
                            setPenWidth(width);
                            setWidthMenuOpen(false);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-zinc-100"
                        >
                          <span
                            className={`rounded-full bg-zinc-500 ${
                              penWidth === width ? "ring-2 ring-offset-1 ring-zinc-400" : ""
                            }`}
                            style={{ width: width + 2, height: width + 2 }}
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {tool === "eraser" && (
                <p className="shrink-0 text-xs text-zinc-400">
                  드래그한 부분만 지워져요
                </p>
              )}
              <button
                type="button"
                onClick={clearDrawing}
                aria-label="전체 지우기"
                className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-zinc-500 hover:text-zinc-700"
              >
                <Trash2 size={14} />
                <span className="hidden sm:inline">전체 지우기</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* OMR 패널(데스크톱)은 전체보기/문제별 보기 어느 쪽에 있든 똑같이 붙어 있어야
          어느 문제를 풀든 바로 전체 채점을 할 수 있다. PDF는 파싱/렌더링 비용이 커서
          탭을 바꿔도 언마운트하지 않고 숨기기만 한다(다시 보일 때마다 처음부터 다시
          불러오는 것을 피하기 위함). */}
      <div className="flex min-h-0 flex-1 justify-center">
        <div className="flex min-h-0 w-full max-w-7xl">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              ref={pdfWrapperRef}
              className={`relative min-h-0 flex-1 ${viewMode === "full" ? "block" : "hidden"}`}
            >
              <PdfCanvasViewer
                fileUrl={fileUrl}
                tool={tool}
                penColor={penColor}
                penWidth={penWidth}
                zoom={zoom}
                onZoomChange={handlePinchZoom}
                active={viewMode === "full"}
                onClearReady={registerClearDrawing}
              />
              {/* 모바일은 헤더가 좁아 데스크톱용 줌 버튼을 넣기 어려워, 시험지 위에
                  떠 있는 형태의 줌 컨트롤을 따로 둔다. */}
              <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-full border border-zinc-200 bg-white/95 shadow-md lg:hidden">
                <button
                  type="button"
                  onClick={zoomIn}
                  disabled={zoom >= MAX_ZOOM}
                  aria-label="시험지 확대"
                  className="flex items-center justify-center p-2.5 text-zinc-600 active:bg-zinc-100 disabled:opacity-30"
                >
                  <ZoomIn size={20} />
                </button>
                <button
                  type="button"
                  onClick={zoomOut}
                  disabled={zoom <= MIN_ZOOM}
                  aria-label="시험지 축소"
                  className="flex items-center justify-center border-t border-zinc-200 p-2.5 text-zinc-600 active:bg-zinc-100 disabled:opacity-30"
                >
                  <ZoomOut size={20} />
                </button>
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
                penWidth={penWidth}
                onClearReady={registerClearSingleDrawing}
                onSubmit={handleSubmit}
                submitting={isPending}
                submitted={!!result}
                answeredCount={answeredCount}
                error={error}
              />
            )}
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
