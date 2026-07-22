"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  ChevronLeft,
  Clock,
  Eraser,
  Hand,
  Maximize,
  Minimize,
  PenLine,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  startCbtAttempt,
  submitCbtAttempt,
  type CbtSubmitResult,
} from "@/app/papers/actions";
import { CbtDrawingToolbar, PEN_COLORS } from "@/components/cbt-drawing-toolbar";
import { OmrPanel } from "@/components/cbt-omr-panel";
import { CbtResultModal } from "@/components/cbt-result-modal";
import { CbtViewModeLock } from "@/components/cbt-view-mode-lock";
import { DEFAULT_PEN_WIDTH, type DrawTool } from "@/components/pdf-canvas-viewer";
import { SingleQuestionView } from "@/components/single-question-view";
import { MIN_ATTEMPT_SECONDS } from "@/lib/cbt-attempt";
import { formatDuration } from "@/lib/format";

// pdf.js는 브라우저 전용 API(Worker, canvas 등)에 의존해서 서버에서 미리 렌더링하면
// 안 되므로, 이 컴포넌트는 클라이언트에서만 로드한다.
const PdfCanvasViewer = dynamic(
  () => import("@/components/pdf-canvas-viewer").then((m) => m.PdfCanvasViewer),
  { ssr: false },
);

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// 태블릿 가로에서는 브라우저 크롬(탭·주소창)에 사이트 헤더까지 겹쳐 세로 공간을
// 크게 잡아먹어, 문제별 풀기에서 문제 이미지가 세로로 잘려 스크롤해야 보인다.
// solver 루트를 브라우저 전체화면으로 띄우면 그 크롬과(그리고 solver 밖에 있는
// 사이트 헤더도) 사라져 세로 공간을 통째로 되찾는다. Safari 계열은 webkit
// 프리픽스만 있어 둘 다 커버하고, 아이폰처럼 아예 지원하지 않는 기기에서는
// supported가 false가 되어 버튼 자체를 숨긴다.
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
  webkitFullscreenEnabled?: boolean;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void;
};

function currentFullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  // 지원 여부는 클라이언트에서만 알 수 있어(document 접근) 마운트 후에 채운다.
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    const doc = document as FullscreenDocument;
    // 지원 여부는 서버에서 알 수 없어 SSR은 항상 "미지원"으로 그리고, 하이드레이션
    // 이후 여기서 실제 값으로 맞춘다(서버/클라 첫 렌더 불일치를 피하려는 의도적
    // 마운트 후 setState라, 이 줄에 한해 set-state-in-effect 경고를 끈다).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(Boolean(document.fullscreenEnabled || doc.webkitFullscreenEnabled));

    // ESC나 시스템 제스처로 전체화면을 빠져나가도 버튼 아이콘이 실제 상태와 어긋나지
    // 않도록, 상태는 언제나 브라우저가 알려주는 fullscreenchange를 따라간다.
    function handleChange() {
      setIsFullscreen(currentFullscreenElement() === ref.current);
    }
    document.addEventListener("fullscreenchange", handleChange);
    document.addEventListener("webkitfullscreenchange", handleChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
      document.removeEventListener("webkitfullscreenchange", handleChange);
    };
  }, [ref]);

  const toggle = useCallback(() => {
    const el = ref.current as FullscreenElement | null;
    if (!el) return;
    if (currentFullscreenElement()) {
      const doc = document as FullscreenDocument;
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    } else if (el.requestFullscreen) {
      void el.requestFullscreen().catch(() => {});
    } else {
      el.webkitRequestFullscreen?.();
    }
  }, [ref]);

  return { isFullscreen, supported, toggle };
}

// 페이지에 들어오면 곧바로 재기 시작하는 대신 5초 카운트다운을 보여주고, 그
// 카운트다운이 끝나면 서버에 시작 시각을 기록한다(startCbtAttempt). 채점 시 최소
// 응시시간(3분) 검증은 이 서버 기록 시각을 기준으로 하므로, 클라이언트도 반드시
// 그 응답의 시각을 기다렸다가 기준으로 삼아야 한다 — 응답을 기다리지 않고 클라이언트
// 자기 시계로 먼저 타이머를 시작해버리면, 그 사이의 네트워크 지연(드물게는 수십
// 초까지도)만큼 서버 기준 3분이 화면보다 항상 늦게 끝나 실제로는 3분보다 더
// 기다려야 제출되는 문제가 생긴다. running이 꺼지면(채점 완료) 시간도 멈춘다.
function useCbtTimer(paperId: string, running: boolean) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [countdown, setCountdown] = useState(5);
  const [started, setStarted] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startedAtRef = useRef(0);
  const startRequestedRef = useRef(false);

  const requestStart = useCallback(() => {
    startRequestedRef.current = true;
    setStartError(null);
    startCbtAttempt(paperId).then((res) => {
      if (res.error || !res.startedAt) {
        startRequestedRef.current = false;
        setStartError(res.error ?? "시작 기록에 실패했어요.");
        return;
      }
      startedAtRef.current = new Date(res.startedAt).getTime();
      setStarted(true);
    });
  }, [paperId]);

  useEffect(() => {
    if (countdown <= 0) {
      if (!startRequestedRef.current) requestStart();
      return;
    }
    const timeout = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timeout);
  }, [countdown, requestStart]);

  useEffect(() => {
    if (!running || !started) return;
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [running, started]);

  function resetTimer() {
    setElapsedSeconds(0);
    setCountdown(5);
    setStarted(false);
    startRequestedRef.current = false;
  }

  return { countdown, elapsedSeconds, started, startError, startedAtRef, resetTimer, requestStart };
}

// 저장 버튼이 따로 없어서, 채점 전에 페이지를 벗어나면 지금까지 고른 답이 그냥
// 사라진다. 새로고침/닫기/주소창 이동은 beforeunload로, 링크 클릭이나(사이트
// 헤더의 로고·마이페이지 링크 포함) 로그아웃 폼 제출은 클릭/제출을 가로채 확인
// 창을 띄우는 방식으로 막는다. 채점이 끝나면(active=false) 더 잃을 게 없으니 풀어준다.
function useLeaveConfirmation(active: boolean) {
  useEffect(() => {
    if (!active) return;

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
  }, [active]);
}

// 문제별 보기에서 다음/이전 문항으로 넘어갈 때마다 이미지를 새로 받느라, 상단 번호는
// 바로 바뀌는데 문제 사진은 뒤늦게 뜨는 문제가 있었다. 두 단계로 미리 받아둔다.
//
// 1) 지금 문항 앞뒤(다음 우선)를 fetchPriority=high로 먼저 받고 decode()까지 끝낸다.
//    캐시에 있어도 <img src> 교체 시 메인 스레드 디코드가 한 박자 늦게 그려지던 걸,
//    미리 디코드해 두면 즉시 그려진다. 넘기는 순간 대기 시간을 없애는 핵심이다.
// 2) 나머지 전체 문항은 낮은 우선순위로 배경에서 마저 받아둬 캐시를 데운다. 예전처럼
//    켜자마자 전부를 한꺼번에 쏘면 브라우저 동시 연결(6개) 한도에 막혀 바로 볼 다음
//    이미지가 뒤로 밀렸는데, 앞뒤 창을 먼저 처리하므로 그 경쟁이 사라진다.
function useQuestionImagePreload(
  viewMode: "full" | "single",
  questionImages: Record<number, string[]>,
  currentQuestionIndex: number,
) {
  // 다음 문항을 먼저, 그다음 다음+1·이전·현재 순으로 받아 디코드한다. 매 이동마다
  // 새 창을 처리하므로 far 문항도 도달하기 전에 디코드까지 끝나 있게 된다.
  useEffect(() => {
    if (viewMode !== "single") return;
    for (const offset of [1, 2, -1, 0]) {
      const srcs = questionImages[currentQuestionIndex + 1 + offset];
      if (!srcs) continue;
      for (const src of srcs) {
        const img = new Image();
        if (offset === 1) img.fetchPriority = "high";
        img.src = src;
        // 캐시에 있으면 즉시 끝나고, 없으면 받은 뒤 디코드까지 끝낸다.
        img.decode?.().catch(() => {});
      }
    }
  }, [viewMode, questionImages, currentQuestionIndex]);

  // 앞뒤 창 밖의 나머지는 한 번만 낮은 우선순위로 마저 받아둔다.
  const bulkWarmedRef = useRef(false);
  useEffect(() => {
    if (viewMode !== "single" || bulkWarmedRef.current) return;
    bulkWarmedRef.current = true;
    for (const images of Object.values(questionImages)) {
      for (const src of images) {
        const img = new Image();
        img.fetchPriority = "low";
        img.src = src;
      }
    }
  }, [viewMode, questionImages]);
}

// 시험지 배율 상태와 그걸 조절하는 세 가지 입력(버튼 클릭, 모바일 핀치, 트랙패드
// 핀치/Ctrl+휠)을 묶은 훅.
function useExamZoom(pdfWrapperRef: RefObject<HTMLDivElement | null>) {
  const [zoom, setZoom] = useState(1);

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
  }, [pdfWrapperRef]);

  return { zoom, zoomIn, zoomOut, handlePinchZoom };
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
  const [result, setResult] = useState<CbtSubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [tool, setTool] = useState<DrawTool>("move");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_WIDTH);

  const clearDrawingRef = useRef<() => void>(() => {});
  const clearSingleDrawingRef = useRef<() => void>(() => {});
  const pdfWrapperRef = useRef<HTMLDivElement>(null);
  const solverRootRef = useRef<HTMLDivElement>(null);
  const { zoom, zoomIn, zoomOut, handlePinchZoom } = useExamZoom(pdfWrapperRef);
  const {
    isFullscreen,
    supported: fullscreenSupported,
    toggle: toggleFullscreen,
  } = useFullscreen(solverRootRef);

  const hasQuestionImages = Object.keys(questionImages).length > 0;
  // 사이트 기본값은 "문제별 풀기"다. 계정에 "전체보기"가 명시적으로 잠겨 있으면
  // 그걸 따르고, 그 외에는(잠긴 게 없거나 "문제별 풀기"로 잠겨 있으면) 문제별
  // 풀기로 시작한다. 다만 이 문제지에 문항별 이미지가 아직 없으면 그 탭 자체가
  // 막혀 있으니 전체보기로 시작한다.
  const [viewMode, setViewMode] = useState<"full" | "single">(
    defaultViewMode === "full" ? "full" : hasQuestionImages ? "single" : "full",
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // 세트문제(공통지문 공유)는 연속된 문제번호가 완전히 같은 이미지 경로를
  // 가리킨다(크롭 스크립트가 그렇게 저장한다) — 바이트를 다시 비교할 필요 없이
  // 이미지 배열이 같은지만 보고 같은 세트로 묶는다. 문제별 보기에서 이 세트에
  // 속한 어느 번호로 들어오든 화면에는 세트 전체 번호가 같이 보여야 한다.
  const questionGroups = useMemo(() => {
    const groups = new Map<number, number[]>();
    let i = 1;
    while (i <= totalQuestions) {
      const images = questionImages[i] ?? [];
      let end = i;
      if (images.length > 0) {
        while (
          end + 1 <= totalQuestions &&
          questionImages[end + 1]?.length === images.length &&
          questionImages[end + 1]?.every((src, idx) => src === images[idx])
        ) {
          end++;
        }
      }
      const numbers: number[] = [];
      for (let n = i; n <= end; n++) numbers.push(n);
      for (const n of numbers) groups.set(n, numbers);
      i = end + 1;
    }
    return groups;
  }, [questionImages, totalQuestions]);

  const { countdown, elapsedSeconds, started, startError, startedAtRef, resetTimer, requestStart } =
    useCbtTimer(paperId, !result);
  useLeaveConfirmation(!result);
  useQuestionImagePreload(viewMode, questionImages, currentQuestionIndex);

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
    if (!started) {
      alert("시작 기록 확인 중이에요. 잠시 후 다시 시도해주세요.");
      return;
    }
    // 실제 최소 응시시간 검증은 서버가 하지만, 3분이 안 지났으면 서버까지 왕복하지
    // 않고 바로 알려준다. startedAtRef는 서버가 실제로 기록한 시각이라(클라이언트가
    // 응답을 기다리지 않고 먼저 잰 시각이 아니라) 이 검사가 서버 판정과 일치한다.
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
    resetTimer();
  }

  const resultByQuestion = new Map(
    (result?.questionResults ?? []).map((q) => [q.question_number, q]),
  );

  // 세트로 묶인 문제는 이전/다음 이동도 개별 번호가 아니라 세트 단위로 건너뛴다
  // (세트 안 다른 번호로 옮겨봐야 화면에 보이는 이미지가 똑같기 때문).
  const currentGroupNumbers = questionGroups.get(currentQuestionIndex + 1) ?? [
    currentQuestionIndex + 1,
  ];
  const groupFirstNumber = currentGroupNumbers[0];
  const groupLastNumber = currentGroupNumbers[currentGroupNumbers.length - 1];
  const prevNumber = groupFirstNumber > 1 ? groupFirstNumber - 1 : null;
  const prevGroupNumbers = prevNumber
    ? (questionGroups.get(prevNumber) ?? [prevNumber])
    : null;
  const prevQuestionIndex = prevGroupNumbers ? prevGroupNumbers[0] - 1 : null;
  const nextQuestionIndex = groupLastNumber < totalQuestions ? groupLastNumber : null;

  return (
    // SiteHeaderGate가 lg 이상에서는 전역 사이트 헤더(약 65px)를 그대로 보여주는데,
    // 100dvh는 그 헤더를 포함한 뷰포트 전체 높이라서 그만큼을 빼주지 않으면
    // 화면 하단(OMR 제출 버튼 등)이 잘린다. lg 미만은 헤더가 아예 없으니 그대로 둔다.
    // 전체화면일 때는 solver 밖의 사이트 헤더가 렌더되지 않으므로 그 65px 보정도
    // 빼야 한다 — 안 그러면 하단에 65px 빈 공간이 남고 제출 버튼이 잘린다.
    <div
      ref={solverRootRef}
      className={`flex h-[100dvh] flex-col bg-white dark:bg-zinc-900 ${
        isFullscreen ? "" : "lg:h-[calc(100dvh-65px)]"
      }`}
    >
      {/* 헤더/탭/펜 색상 바를 하나의 그룹으로 묶어서, 각 줄마다 구분선이 겹겹이
          쌓이지 않게 내부 구분선 없이 콘텐츠와 닿는 맨 아래에만 선을 둔다. */}
      <div className="shrink-0 border-b border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <header>
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                href={`/papers/${paperId}`}
                aria-label="문제지로 돌아가기"
                className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <ChevronLeft size={20} />
              </Link>
              <h1 className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {paperTitle}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex items-center gap-1 text-sm font-medium text-zinc-600 dark:text-zinc-400">
                <Clock size={16} />
                {countdown > 0 ? (
                  `${countdown}초 후 시작`
                ) : startError ? (
                  <button
                    type="button"
                    onClick={requestStart}
                    className="text-red-600 underline underline-offset-2 dark:text-red-400"
                  >
                    시작 기록 실패, 다시 시도
                  </button>
                ) : started ? (
                  formatDuration(elapsedSeconds)
                ) : (
                  "시작하는 중..."
                )}
              </div>
              <div className="hidden items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 lg:flex dark:bg-zinc-800">
                <button
                  type="button"
                  onClick={zoomOut}
                  disabled={zoom <= MIN_ZOOM}
                  aria-label="시험지 축소"
                  className="flex items-center justify-center rounded-md p-1.5 text-zinc-600 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  <ZoomOut size={18} />
                </button>
                <span className="w-10 text-center text-xs font-medium text-zinc-500 dark:text-zinc-500">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={zoomIn}
                  disabled={zoom >= MAX_ZOOM}
                  aria-label="시험지 확대"
                  className="flex items-center justify-center rounded-md p-1.5 text-zinc-600 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700"
                >
                  <ZoomIn size={18} />
                </button>
              </div>
              {fullscreenSupported && (
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? "전체화면 종료" : "전체화면"}
                  aria-pressed={isFullscreen}
                  className="hidden items-center justify-center rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 sm:flex dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                </button>
              )}
              <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
                <button
                  type="button"
                  onClick={() => setTool("move")}
                  aria-label="화면 이동"
                  aria-pressed={tool === "move"}
                  className={`flex items-center justify-center rounded-md p-1.5 ${
                    tool === "move"
                      ? "bg-blue-600 text-white"
                      : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
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
                      : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
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
                      : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
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
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-800"
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
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-800"
              }`}
            >
              전체보기
            </button>
            <CbtViewModeLock
              viewMode={viewMode}
              initialDefaultViewMode={defaultViewMode}
            />
            {/* 문제별 풀기(lg)에서는 문항 번호·제출을 이 탭 줄 오른쪽에 붙여, 문제별
                뷰가 따로 갖던 헤더 한 줄(약 40px)을 없앤다 — 태블릿 가로에서 문제가
                한눈에 들어오도록 세로 공간을 아끼는 게 목적. 폭이 좁은 모바일에서는
                줄이 넘칠 수 있어 숨기고, 그쪽은 문제별 뷰의 자체 헤더를 그대로 쓴다. */}
            {viewMode === "single" && (
              <div className="ml-auto hidden items-center gap-2 lg:flex">
                <div className="text-sm">
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">
                    {groupFirstNumber === groupLastNumber
                      ? `${groupFirstNumber}번`
                      : `${groupFirstNumber}~${groupLastNumber}번`}
                  </span>
                  <span className="text-zinc-400 dark:text-zinc-600">
                    {" "}
                    / {totalQuestions}
                  </span>
                </div>
                {!result && (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPending}
                    className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
                  >
                    {isPending ? "채점 중..." : `제출 (${answeredCount}/${totalQuestions})`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <CbtDrawingToolbar
          tool={tool}
          penColor={penColor}
          onPenColorChange={setPenColor}
          penWidth={penWidth}
          onPenWidthChange={setPenWidth}
          onClearDrawing={clearDrawing}
        />
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
              <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-full border border-zinc-200 bg-white/95 shadow-md lg:hidden dark:border-zinc-700 dark:bg-zinc-900/95">
                <button
                  type="button"
                  onClick={zoomIn}
                  disabled={zoom >= MAX_ZOOM}
                  aria-label="시험지 확대"
                  className="flex items-center justify-center p-2.5 text-zinc-600 active:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:active:bg-zinc-800"
                >
                  <ZoomIn size={20} />
                </button>
                <button
                  type="button"
                  onClick={zoomOut}
                  disabled={zoom <= MIN_ZOOM}
                  aria-label="시험지 축소"
                  className="flex items-center justify-center border-t border-zinc-200 p-2.5 text-zinc-600 active:bg-zinc-100 disabled:opacity-30 dark:border-zinc-700 dark:text-zinc-400 dark:active:bg-zinc-800"
                >
                  <ZoomOut size={20} />
                </button>
              </div>
            </div>

            {viewMode === "single" && (
              <SingleQuestionView
                questionIndex={currentQuestionIndex}
                totalQuestions={totalQuestions}
                questions={currentGroupNumbers.map((number) => ({
                  number,
                  choiceCount: questionChoiceCounts[number] ?? choiceCount,
                  selected: answers[number - 1],
                  onSelect: (choice: number) => selectChoice(number - 1, choice),
                  questionResult: result ? (resultByQuestion.get(number) ?? null) : null,
                }))}
                images={questionImages[currentQuestionIndex + 1] ?? []}
                prevIndex={prevQuestionIndex}
                nextIndex={nextQuestionIndex}
                onNavigate={setCurrentQuestionIndex}
                tool={tool}
                penColor={penColor}
                penWidth={penWidth}
                onClearReady={registerClearSingleDrawing}
                onSubmit={handleSubmit}
                submitting={isPending}
                submitted={!!result}
                answeredCount={answeredCount}
                error={error}
                zoom={zoom}
                onPinchZoom={handlePinchZoom}
              />
            )}
          </div>

          <OmrPanel
            className="hidden w-[240px] shrink-0 flex-col border-l border-zinc-200 lg:flex dark:border-zinc-700"
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
          <div className="relative flex max-h-[65dvh] flex-col rounded-t-2xl bg-white shadow-xl dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 dark:border-zinc-700">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">답안 입력</h2>
              <button
                type="button"
                aria-label="닫기"
                onClick={() => setOmrOpen(false)}
                className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-800"
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
        <CbtResultModal result={result} paperId={paperId} onRetry={handleRetry} />
      )}
    </div>
  );
}
