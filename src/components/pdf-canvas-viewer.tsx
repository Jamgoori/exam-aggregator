"use client";

import { useEffect, useRef, useState } from "react";

// pdf.js 워커(legacy 빌드)는 node_modules에서 매 설치(postinstall)마다
// public/pdf.worker.min.mjs로 복사해서 같은 출처(same-origin) 정적 파일로 서빙한다.
// 번들러(터보팩/웹팩) 자산 처리 방식 차이나 CDN 의존성 없이 항상 설치된 pdfjs-dist
// 버전과 정확히 맞물리게 하기 위함.
const WORKER_SRC = "/pdf.worker.min.mjs";

// 문항 페이지 위에 손글씨로 메모하는 용도의 캔버스. PDF 페이지마다 별도의 주석 캔버스를
// 페이지 캔버스 바로 위에 겹쳐서, 스크롤해도 필기가 해당 페이지에 그대로 붙어 있게 한다
// (전체 스크롤 영역을 하나의 큰 캔버스로 덮으면 페이지가 많을 때 캔버스 크기가 과도하게
// 커져 저사양 기기에서 메모리 문제가 생길 수 있어 페이지 단위로 나눴다).
function attachDrawing(
  canvas: HTMLCanvasElement,
  penModeRef: { current: boolean },
  penColorRef: { current: string },
) {
  let drawing = false;
  let last: { x: number; y: number } | null = null;

  function getPoint(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!penModeRef.current) return;
    drawing = true;
    last = getPoint(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!penModeRef.current || !drawing || !last) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const point = getPoint(e);
    ctx.strokeStyle = penColorRef.current;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    last = point;
  });
  const stop = () => {
    drawing = false;
    last = null;
  };
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointerleave", stop);
}

export function PdfCanvasViewer({
  fileUrl,
  penMode,
  penColor,
  onClearReady,
}: {
  fileUrl: string;
  penMode: boolean;
  penColor: string;
  // next/dynamic(ssr:false)로 불러오는 컴포넌트는 일반 함수 컴포넌트로 감싸져서
  // ref가 전달되지 않으므로(useImperativeHandle을 못 씀), "지우기" 함수를 콜백으로
  // 등록받는 방식으로 부모에게 노출한다.
  onClearReady?: (clear: () => void) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const annotationCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  const penModeRef = useRef(penMode);
  const penColorRef = useRef(penColor);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    penModeRef.current = penMode;
    for (const canvas of annotationCanvasesRef.current) {
      canvas.style.pointerEvents = penMode ? "auto" : "none";
    }
  }, [penMode]);

  useEffect(() => {
    penColorRef.current = penColor;
  }, [penColor]);

  useEffect(() => {
    onClearReady?.(() => {
      for (const canvas of annotationCanvasesRef.current) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    });
  }, [onClearReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const renderTasks: { cancel: () => void }[] = [];
    annotationCanvasesRef.current = [];
    container.innerHTML = "";
    setLoading(true);
    setError(null);

    async function run() {
      try {
        // "legacy" 빌드는 Uint8Array.prototype.toHex처럼 아주 최근에 추가된 JS 엔진
        // 기능이 없는 브라우저(구형 삼성인터넷 등)를 위해 폴리필을 포함한다. 기본
        // 빌드는 그런 폴리필이 없어서 해당 브라우저에서 "toHex is not a function"으로
        // 죽는다.
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;

        // Range 요청(부분 다운로드)은 Supabase Storage 쪽 CORS preflight에 걸려
        // 실패할 수 있어서, 단순 GET 한 번으로 전체를 받아오게 강제한다.
        const doc = await pdfjsLib.getDocument({
          url: fileUrl,
          disableRange: true,
          disableStream: true,
        }).promise;
        if (cancelled) return;

        const containerWidth = container!.clientWidth || 800;
        const dpr = window.devicePixelRatio || 1;

        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
          if (cancelled) return;
          const page = await doc.getPage(pageNumber);
          const unscaledViewport = page.getViewport({ scale: 1 });
          const cssScale = containerWidth / unscaledViewport.width;
          const viewport = page.getViewport({ scale: cssScale * dpr });
          const cssWidth = viewport.width / dpr;
          const cssHeight = viewport.height / dpr;

          const pageWrapper = document.createElement("div");
          pageWrapper.style.position = "relative";
          pageWrapper.style.width = `${cssWidth}px`;
          pageWrapper.style.height = `${cssHeight}px`;
          pageWrapper.style.marginBottom = "8px";

          const contentCanvas = document.createElement("canvas");
          contentCanvas.width = viewport.width;
          contentCanvas.height = viewport.height;
          contentCanvas.style.width = `${cssWidth}px`;
          contentCanvas.style.height = `${cssHeight}px`;
          contentCanvas.style.display = "block";
          pageWrapper.appendChild(contentCanvas);

          const annotationCanvas = document.createElement("canvas");
          annotationCanvas.width = cssWidth;
          annotationCanvas.height = cssHeight;
          annotationCanvas.style.width = `${cssWidth}px`;
          annotationCanvas.style.height = `${cssHeight}px`;
          annotationCanvas.style.position = "absolute";
          annotationCanvas.style.left = "0";
          annotationCanvas.style.top = "0";
          annotationCanvas.style.touchAction = "none";
          annotationCanvas.style.pointerEvents = penModeRef.current
            ? "auto"
            : "none";
          pageWrapper.appendChild(annotationCanvas);
          annotationCanvasesRef.current.push(annotationCanvas);
          attachDrawing(annotationCanvas, penModeRef, penColorRef);

          container!.appendChild(pageWrapper);

          const task = page.render({ canvas: contentCanvas, viewport });
          renderTasks.push(task);
          await task.promise;
        }
      } catch (err) {
        if (!cancelled) {
          console.error("PDF 렌더링 실패:", err);
          // 모바일에서는 콘솔을 볼 수 없는 경우가 많아, 원인 파악을 위해 실제 에러
          // 메시지를 화면에도 그대로 보여준다 (임시 진단용 — 원인 확정되면 걷어낼 것).
          const detail =
            err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          setError(`PDF를 불러오지 못했어요.\n${detail}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
      renderTasks.forEach((t) => t.cancel());
    };
  }, [fileUrl]);

  return (
    <div className="relative h-full w-full overflow-y-auto bg-zinc-200">
      {loading && (
        <p className="p-4 text-center text-sm text-zinc-500">불러오는 중...</p>
      )}
      {error && (
        <p className="whitespace-pre-wrap p-4 text-center text-sm text-red-600">
          {error}
        </p>
      )}
      <div
        ref={containerRef}
        className="mx-auto flex w-full flex-col items-center py-2"
      />
    </div>
  );
}
