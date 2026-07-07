"use client";

import { useEffect, useRef, useState } from "react";

// pdf.js 워커(legacy 빌드)는 node_modules에서 매 설치(postinstall)마다
// public/pdf.worker.min.mjs로 복사해서 같은 출처(same-origin) 정적 파일로 서빙한다.
// 번들러(터보팩/웹팩) 자산 처리 방식 차이나 CDN 의존성 없이 항상 설치된 pdfjs-dist
// 버전과 정확히 맞물리게 하기 위함.
const WORKER_SRC = "/pdf.worker.min.mjs";

export type DrawTool = "move" | "pen" | "eraser";

const PEN_LINE_WIDTH = 3;
const ERASER_LINE_WIDTH = 24;

// 문항 페이지 위에 손글씨로 메모하는 용도의 캔버스. PDF 페이지마다 별도의 주석 캔버스를
// 페이지 캔버스 바로 위에 겹쳐서, 스크롤해도 필기가 해당 페이지에 그대로 붙어 있게 한다
// (전체 스크롤 영역을 하나의 큰 캔버스로 덮으면 페이지가 많을 때 캔버스 크기가 과도하게
// 커져 저사양 기기에서 메모리 문제가 생길 수 있어 페이지 단위로 나눴다).
// 지우개는 destination-out으로 그려서, 이 캔버스(필기)에서만 지나간 자리만큼 지워지고
// 아래 PDF 페이지 캔버스에는 전혀 영향을 주지 않는다.
export function attachDrawing(
  canvas: HTMLCanvasElement,
  toolRef: { current: DrawTool },
  penColorRef: { current: string },
  zoomRef: { current: number },
) {
  let drawing = false;
  let last: { x: number; y: number } | null = null;

  // CSS zoom은 화면에 보이는 크기(getBoundingClientRect)만 확대하고 캔버스의
  // 실제 좌표계(내부 픽셀 그리드)는 그대로이므로, zoom 배율만큼 나눠줘야
  // 확대된 상태에서도 클릭한 위치에 정확히 그려진다.
  function getPoint(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / zoomRef.current,
      y: (e.clientY - rect.top) / zoomRef.current,
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (toolRef.current === "move") return;
    drawing = true;
    last = getPoint(e);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (toolRef.current === "move" || !drawing || !last) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const isEraser = toolRef.current === "eraser";
    const point = getPoint(e);
    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
    ctx.strokeStyle = penColorRef.current;
    ctx.lineWidth = isEraser ? ERASER_LINE_WIDTH : PEN_LINE_WIDTH;
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
  tool,
  penColor,
  zoom = 1,
  active = true,
  onClearReady,
}: {
  fileUrl: string;
  tool: DrawTool;
  penColor: string;
  // 시험지(PDF)에만 적용되는 확대 배율. OMR 패널 등 나머지 UI는 이 값과 무관하게
  // 그대로 유지된다.
  zoom?: number;
  // 이 뷰어가 지금 화면에 보이는지(전체보기 탭인지). 문제별 풀기 탭에서는 부모가
  // display:none으로 감춰두는데, 그 상태에서 전체보기로 전환될 때 조상의 display
  // 토글을 ResizeObserver가 놓치는 경우가 있어("불러오는 중"에서 멈춤), 보이게 되는
  // 순간 직접 폭을 재서 렌더를 트리거하기 위한 값이다.
  active?: boolean;
  // next/dynamic(ssr:false)로 불러오는 컴포넌트는 일반 함수 컴포넌트로 감싸져서
  // ref가 전달되지 않으므로(useImperativeHandle을 못 씀), "지우기" 함수를 콜백으로
  // 등록받는 방식으로 부모에게 노출한다.
  onClearReady?: (clear: () => void) => void;
}) {
  const scrollWrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const annotationCanvasesRef = useRef<HTMLCanvasElement[]>([]);
  const toolRef = useRef(tool);
  const penColorRef = useRef(penColor);
  const zoomRef = useRef(zoom);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 렌더링에 쓸 실제 폭. 문제별 보기 탭일 때 이 뷰어는 display:none이라 clientWidth가
  // 0인데, 그 상태에서 그려버리면 폭 0 → 폴백값으로 렌더돼 나중에 전체보기로 왔을 때
  // 모바일 화면을 크게 넘치게 나온다("줌이 이상하고 움직이지 않는" 증상). 그래서 실제
  // 폭이 잡히거나(0→표시) 화면 회전/리사이즈로 바뀔 때마다 그 폭으로 (다시) 렌더한다.
  const [renderWidth, setRenderWidth] = useState(0);

  useEffect(() => {
    const el = scrollWrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const width = el.clientWidth;
      // 세로 스크롤바는 항상 있으니 clientWidth는 zoom을 바꿔도 흔들리지 않는다
      // (가로 스크롤바는 clientHeight만 깎음). 실제 레이아웃 폭이 바뀔 때만 반영한다.
      if (width > 0) {
        setRenderWidth((prev) => (Math.abs(prev - width) > 1 ? width : prev));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 문제별 풀기 → 전체보기로 전환돼 이 뷰어가 다시 보이게 되는 순간, ResizeObserver가
  // 조상의 display:none→block 토글을 놓쳐 renderWidth가 0에 머무는 경우가 있다. 그러면
  // 렌더 이펙트가 계속 early-return 해서 "불러오는 중"에서 멈춘다. 보이게 되는 시점에
  // 직접 폭을 한 번 재서 렌더를 트리거해, ResizeObserver 발화 여부와 무관하게 그린다.
  useEffect(() => {
    if (!active) return;
    const el = scrollWrapperRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const width = el.clientWidth;
      if (width > 0) {
        setRenderWidth((prev) => (Math.abs(prev - width) > 1 ? width : prev));
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  useEffect(() => {
    toolRef.current = tool;
    for (const canvas of annotationCanvasesRef.current) {
      canvas.style.pointerEvents = tool === "move" ? "none" : "auto";
    }
  }, [tool]);

  useEffect(() => {
    penColorRef.current = penColor;
  }, [penColor]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

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
    // 실제 폭이 아직 안 잡혔으면(숨겨진 상태 등) 렌더링을 미룬다. 폭이 잡히는 순간
    // renderWidth가 바뀌면서 이 이펙트가 다시 돌아 올바른 폭으로 그린다.
    if (!container || renderWidth <= 0) return;

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

        const containerWidth = renderWidth;
        const dpr = window.devicePixelRatio || 1;

        // 먼저 페이지 객체를 전부 병렬로 가져와서(가벼운 메타데이터 조회) 스크롤
        // 레이아웃(빈 캔버스)을 한 번에 순서대로 만들어두고, 실제 렌더링(무거운 작업,
        // 워커에서 처리됨)은 그 다음에 여러 페이지를 동시에 진행한다. 페이지를 하나씩
        // 순서대로 렌더링하면 마지막 페이지가 보이기까지 모든 페이지 렌더링 시간이
        // 그대로 누적돼서, 문항 수가 많은 문제지일수록 체감 로딩이 느려졌었다.
        const pages = await Promise.all(
          Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)),
        );
        if (cancelled) return;

        const pendingRenders: {
          contentCanvas: HTMLCanvasElement;
          viewport: import("pdfjs-dist/legacy/build/pdf.mjs").PageViewport;
          page: Awaited<ReturnType<typeof doc.getPage>>;
        }[] = [];

        for (const page of pages) {
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
          annotationCanvas.style.pointerEvents =
            toolRef.current === "move" ? "none" : "auto";
          pageWrapper.appendChild(annotationCanvas);
          annotationCanvasesRef.current.push(annotationCanvas);
          attachDrawing(annotationCanvas, toolRef, penColorRef, zoomRef);

          container!.appendChild(pageWrapper);
          pendingRenders.push({ contentCanvas, viewport, page });
        }

        setLoading(false);

        const RENDER_CONCURRENCY = 3;
        let nextIndex = 0;
        async function renderNext(): Promise<void> {
          while (nextIndex < pendingRenders.length) {
            if (cancelled) return;
            const { contentCanvas, viewport, page } =
              pendingRenders[nextIndex++];
            const task = page.render({ canvas: contentCanvas, viewport });
            renderTasks.push(task);
            await task.promise;
          }
        }
        await Promise.all(
          Array.from({ length: RENDER_CONCURRENCY }, () => renderNext()),
        );
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
  }, [fileUrl, renderWidth]);

  return (
    // 확대(zoom > 1) 시 시험지가 뷰포트보다 넓어지므로 가로 스크롤도 열어둬야 잘린
    // 오른쪽 부분까지 밀어서 볼 수 있다(모바일에서 "움직이지 않는다"던 증상).
    <div
      ref={scrollWrapperRef}
      // scrollbar-gutter: stable — 세로 스크롤바 자리를 항상 예약해둔다. 이게 없으면
      // 렌더 때 컨테이너를 비웠다 채우는 순간 스크롤바가 사라졌다 나타나며 clientWidth가
      // 폭만큼 출렁이고, 그 변화를 ResizeObserver가 잡아 renderWidth를 갱신 → 재렌더 →
      // 다시 clientWidth 변화로 이어지는 무한 루프(전체보기 "깜빡이며 무한 로딩")가 됐다.
      // 공간을 차지하는 클래식 스크롤바(대부분의 Windows Chrome)에서만 나던 문제다.
      style={{ scrollbarGutter: "stable" }}
      className="relative h-full w-full overflow-auto bg-zinc-200"
    >
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
        style={{ zoom }}
      />
    </div>
  );
}
