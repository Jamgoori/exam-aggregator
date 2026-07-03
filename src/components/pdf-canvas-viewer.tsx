"use client";

import { useEffect, useRef, useState } from "react";

// pdf.js 워커는 node_modules에서 매 설치(postinstall)마다 public/pdf.worker.min.mjs로
// 복사해서 같은 출처(same-origin) 정적 파일로 서빙한다. 번들러(터보팩/웹팩) 자산 처리
// 방식 차이나 CDN 의존성 없이 항상 설치된 pdfjs-dist 버전과 정확히 맞물리게 하기 위함.
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
        const pdfjsLib = await import("pdfjs-dist");
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
          setError("PDF를 불러오지 못했어요.");
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
        <p className="p-4 text-center text-sm text-red-600">{error}</p>
      )}
      <div
        ref={containerRef}
        className="mx-auto flex w-full flex-col items-center py-2"
      />
    </div>
  );
}
