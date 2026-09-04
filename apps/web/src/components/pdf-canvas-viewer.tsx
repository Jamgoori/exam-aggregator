"use client";

import { useEffect, useRef, useState } from "react";
import { GraduationCap } from "lucide-react";

// pdf.js 워커(legacy 빌드)는 node_modules에서 매 설치(postinstall)마다
// public/pdf.worker.min.mjs로 복사해서 같은 출처(same-origin) 정적 파일로 서빙한다.
// 번들러(터보팩/웹팩) 자산 처리 방식 차이나 CDN 의존성 없이 항상 설치된 pdfjs-dist
// 버전과 정확히 맞물리게 하기 위함.
const WORKER_SRC = "/pdf.worker.min.mjs";

// JBIG2·JPEG2000 디코더(wasm)도 같은 방식으로 public/ 에 복사해 둔다
// (scripts/copy-pdfjs-assets.mjs). 이 경로를 getDocument에 주지 않으면 pdf.js가
// 그런 이미지가 든 XObject를 **에러도 없이 건너뛴다** — 국내 시험지 PDF는 선지
// 번호(①~⑤)·보기 상자를 JBIG2 흑백 이미지로 심어둔 조판이 흔해서, 없으면 화면에
// 선지 번호가 통째로 안 보인다(실측: 2022 국가직 9급 공직선거법).
const WASM_URL = "/pdf-wasm/";

export type DrawTool = "move" | "pen" | "eraser";

export const DEFAULT_PEN_WIDTH = 1.5;
export const PEN_WIDTH_PRESETS = [1, 2, 3.5];
const ERASER_LINE_WIDTH = 24;

type Point = { x: number; y: number };

// 한 번에 그은 획 하나. 좌표와 굵기를 캔버스에 그린 픽셀로만 두지 않고 이렇게 따로
// 기록해두면, 캔버스 크기가 바뀌거나(캔버스는 크기를 바꾸는 순간 내용이 통째로
// 지워진다) 다른 문항을 보여줬다 돌아왔을 때 그대로 다시 그릴 수 있다.
//
// 좌표·굵기는 모두 "캔버스 버퍼 폭 대비 비율"이다. 확대/축소로 캔버스가 커지거나
// 작아져도 같은 비율에 새 폭을 곱하면 문제 그림 위 같은 자리에 같은 두께로 다시
// 그려진다 — 종이에 밴 잉크처럼 문제와 함께 커지고 작아진다.
export type DrawnStroke = {
  erase: boolean;
  color: string;
  width: number;
  points: Point[];
};

function midPoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// 로딩 중 순서대로 돌려 보여줄 문구. 사이트 컨셉(공무원 시험 합격 응원)에 맞춰
// 단순 "불러오는 중" 대신 격려 톤으로 구성했다.
const LOADING_MESSAGES = [
  "시험지를 펼치는 중이에요",
  "문제를 한 장씩 준비하고 있어요",
  "합격까지 한 걸음, 곧 시작해요",
];

// 문항 페이지 위에 손글씨로 메모하는 용도의 캔버스. PDF 페이지마다 별도의 주석 캔버스를
// 페이지 캔버스 바로 위에 겹쳐서, 스크롤해도 필기가 해당 페이지에 그대로 붙어 있게 한다
// (전체 스크롤 영역을 하나의 큰 캔버스로 덮으면 페이지가 많을 때 캔버스 크기가 과도하게
// 커져 저사양 기기에서 메모리 문제가 생길 수 있어 페이지 단위로 나눴다).
// 지우개는 destination-out으로 그려서, 이 캔버스(필기)에서만 지나간 자리만큼 지워지고
// 아래 PDF 페이지 캔버스에는 전혀 영향을 주지 않는다.
export function attachDrawing({
  canvas,
  toolRef,
  penColorRef,
  zoomRef,
  penWidthRef,
  onPinchZoom,
  onStrokeEnd,
}: {
  canvas: HTMLCanvasElement;
  toolRef: { current: DrawTool };
  penColorRef: { current: string };
  zoomRef: { current: number };
  penWidthRef: { current: number };
  // 두 손가락으로 동시에 짚으면(핀치) 필기 대신 확대/축소로 처리하기 위한 콜백.
  // factor는 직전 프레임 대비 손가락 사이 거리 변화 비율(예: 1.02 = 2% 더 벌어짐)이라,
  // 호출하는 쪽에서 현재 zoom에 그대로 곱해주면 된다. 없으면(문제별 보기처럼 줌 개념이
  // 없는 화면) 두 손가락이 닿아도 그냥 무시한다.
  onPinchZoom?: (factor: number) => void;
  // 획을 하나 다 그을 때마다 그 획을 넘겨준다(DrawnStroke 주석 참고). 받아서 보관해두면
  // 캔버스가 리사이즈되거나 문항이 바뀌어 내용이 지워져도 redrawStrokes로 되살릴 수
  // 있다. 안 넘기면 캔버스에 그려진 픽셀이 전부다(전체보기 PDF는 페이지 캔버스를
  // 통째로 다시 만들며 필기도 같이 비우는 구조라 기록하지 않는다).
  onStrokeEnd?: (stroke: DrawnStroke) => void;
}): () => void {
  let drawing = false;
  let p0: Point | null = null;
  let p1: Point | null = null;
  // 지금 긋고 있는 획의 기록. 손을 떼는 순간 onStrokeEnd로 넘긴다.
  let stroke: DrawnStroke | null = null;

  // 화면(clientX/Y) 기준 좌표로 손가락 두 개의 간격을 추적한다. CSS zoom과 무관하게
  // 항상 실제 보이는 간격이라, 비율만 보면 되고 별도 배율 보정이 필요 없다.
  const activePointers = new Map<number, Point>();
  let lastPinchDistance: number | null = null;

  // 캔버스의 실제 픽셀 버퍼(canvas.width/height)는 화면 배율(devicePixelRatio)만큼
  // CSS 크기보다 더 촘촘하게 만들어져 있다(모바일 고해상도 화면에서 이 배율을 안 곱해주면
  // 브라우저가 저해상도 버퍼를 늘려 그리면서 획이 흐릿하고 연필처럼 번져 보였다).
  // 그만큼 좌표와 선 굵기 모두 곱해줘야 CSS 픽셀 기준으로 또렷하게 그려진다.
  const dpr = window.devicePixelRatio || 1;

  // CSS zoom은 화면에 보이는 크기(getBoundingClientRect)만 확대하고 캔버스의
  // 실제 좌표계(내부 픽셀 그리드)는 그대로이므로, zoom 배율만큼 나눠줘야
  // 확대된 상태에서도 클릭한 위치에 정확히 그려진다.
  function getPoint(e: PointerEvent): Point {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / zoomRef.current) * dpr,
      y: ((e.clientY - rect.top) / zoomRef.current) * dpr,
    };
  }

  // 캔버스 버퍼 좌표를 폭 대비 비율로 바꾼다(DrawnStroke 주석 참고).
  function toStrokeSpace(p: Point): Point {
    const scale = canvas.width || 1;
    return { x: p.x / scale, y: p.y / scale };
  }

  function pinchDistance(): number | null {
    const pts = [...activePointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function handlePointerDown(e: PointerEvent) {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size >= 2) {
      // 두 번째 손가락이 닿는 순간부터 핀치 제스처로 취급하고, 진행 중이던
      // 한 손가락 필기는 어중간한 획으로 남지 않게 취소한다(기록도 버린다 —
      // 화면에 남은 자국은 확대/축소로 캔버스를 다시 그릴 때 같이 사라진다).
      drawing = false;
      p0 = null;
      p1 = null;
      stroke = null;
      lastPinchDistance = pinchDistance();
      return;
    }

    if (toolRef.current === "move") return;
    drawing = true;
    p0 = getPoint(e);
    p1 = null;
    const isEraser = toolRef.current === "eraser";
    stroke = {
      erase: isEraser,
      color: penColorRef.current,
      width:
        ((isEraser ? ERASER_LINE_WIDTH : penWidthRef.current) * dpr) /
        (canvas.width || 1),
      points: [toStrokeSpace(p0)],
    };
  }

  function handlePointerMove(e: PointerEvent) {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size >= 2) {
      const distance = pinchDistance();
      if (onPinchZoom && distance && lastPinchDistance) {
        onPinchZoom(distance / lastPinchDistance);
      }
      lastPinchDistance = distance;
      return;
    }

    if (toolRef.current === "move" || !drawing || !p0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const isEraser = toolRef.current === "eraser";
    const point = getPoint(e);
    stroke?.points.push(toStrokeSpace(point));
    ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
    ctx.strokeStyle = penColorRef.current;
    ctx.lineWidth = (isEraser ? ERASER_LINE_WIDTH : penWidthRef.current) * dpr;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (!p1) {
      // 점이 아직 두 개뿐이라 곡선을 만들 수 없어 직선으로 잇는다.
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      p1 = point;
      return;
    }

    // 매 이동마다 직선으로만 이으면 빠르게 그을 때 각져 보인다("펜촉이 거칠다").
    // 최근 세 점의 중점 두 개를 곡선으로 이어서 부드럽게 그린다.
    const mid1 = midPoint(p0, p1);
    const mid2 = midPoint(p1, point);
    ctx.beginPath();
    ctx.moveTo(mid1.x, mid1.y);
    ctx.quadraticCurveTo(p1.x, p1.y, mid2.x, mid2.y);
    ctx.stroke();
    p0 = p1;
    p1 = point;
  }

  function stop(e: PointerEvent) {
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) lastPinchDistance = null;
    if (activePointers.size === 0) {
      // 점 하나짜리(움직이지 않은 탭)는 화면에도 아무것도 안 그려지므로 넘기지 않는다.
      if (stroke && stroke.points.length > 1) onStrokeEnd?.(stroke);
      stroke = null;
      drawing = false;
      p0 = null;
      p1 = null;
    }
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", stop);
  canvas.addEventListener("pointerleave", stop);
  canvas.addEventListener("pointercancel", stop);

  return function detach() {
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointermove", handlePointerMove);
    canvas.removeEventListener("pointerup", stop);
    canvas.removeEventListener("pointerleave", stop);
    canvas.removeEventListener("pointercancel", stop);
  };
}

// 보관해둔 획을 캔버스에 다시 그린다(캔버스는 먼저 비운다). 지우개 획도 그은 순서
// 그대로 다시 태워야 "지운 자리"가 똑같이 남으므로 배열 순서대로 처리한다.
//
// 경로를 만드는 방식은 실시간으로 그을 때(위 pointermove)와 똑같다 — 첫 두 점은
// 직선, 그 뒤로는 중점끼리 잇는 2차 곡선. 방식이 어긋나면 리사이즈 직후 획 모양이
// 미묘하게 달라져 "필기가 흔들린다"고 느껴진다.
export function redrawStrokes(canvas: HTMLCanvasElement, strokes: DrawnStroke[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const scale = canvas.width;
  for (const stroke of strokes) {
    if (stroke.points.length < 2) continue;
    const pts = stroke.points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    if (pts.length > 2) {
      const start = midPoint(pts[0], pts[1]);
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mid = midPoint(pts[i], pts[i + 1]);
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mid.x, mid.y);
      }
    }
    ctx.stroke();
  }

  // 지우개 획으로 끝났을 수 있으니 합성 모드를 원래대로 돌려놓는다(같은 컨텍스트에
  // 이어서 실시간 필기가 그려진다).
  ctx.globalCompositeOperation = "source-over";
}

export function PdfCanvasViewer({
  fileUrl,
  tool,
  penColor,
  penWidth = DEFAULT_PEN_WIDTH,
  zoom = 1,
  onZoomChange,
  active = true,
  onClearReady,
}: {
  fileUrl: string;
  tool: DrawTool;
  penColor: string;
  // 펜 굵기(px, CSS zoom 배율과 무관한 캔버스 좌표계 기준)
  penWidth?: number;
  // 시험지(PDF)에만 적용되는 확대 배율. OMR 패널 등 나머지 UI는 이 값과 무관하게
  // 그대로 유지된다.
  zoom?: number;
  // 펜/지우개 도구 중에도 두 손가락으로 짚으면 필기 대신 확대/축소가 되도록, 그
  // 배율 변화를 부모(zoom state 보유)에 전달하는 콜백. factor는 직전 대비 배율(예:
  // 1.02)이라 호출하는 쪽에서 현재 zoom에 곱해 적용한다.
  onZoomChange?: (factor: number) => void;
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
  const penWidthRef = useRef(penWidth);
  const onZoomChangeRef = useRef(onZoomChange);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 렌더링에 쓸 실제 폭. 문제별 보기 탭일 때 이 뷰어는 display:none이라 clientWidth가
  // 0인데, 그 상태에서 그려버리면 폭 0 → 폴백값으로 렌더돼 나중에 전체보기로 왔을 때
  // 모바일 화면을 크게 넘치게 나온다("줌이 이상하고 움직이지 않는" 증상). 그래서 실제
  // 폭이 잡히거나(0→표시) 화면 회전/리사이즈로 바뀔 때마다 그 폭으로 (다시) 렌더한다.
  const [renderWidth, setRenderWidth] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  // 로딩이 길어질 때 문구를 순서대로 바꿔가며 보여준다(고정 문구 하나만 있으면
  // 멈춘 것처럼 보일 수 있어서). 로딩이 끝나면 인터벌만 멈추고, 다음 로딩 때는
  // 마지막으로 보여준 문구 다음부터 이어서 돈다.
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 2200);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    const el = scrollWrapperRef.current;
    if (!el) return;
    // 폭이 바뀔 때마다 PDF 전 페이지를 다시 그리는데, 모바일 전체보기에서 OMR 경계선을
    // 손가락으로 끄는 동안에는 폭이 프레임마다 바뀐다. 그대로 두면 끄는 내내 재렌더가
    // 쌓여 화면이 멈춘 듯 버벅이므로, 폭이 멎은 뒤 한 번만 그린다.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const width = el.clientWidth;
        // 세로 스크롤바는 항상 있으니 clientWidth는 zoom을 바꿔도 흔들리지 않는다
        // (가로 스크롤바는 clientHeight만 깎음). 실제 레이아웃 폭이 바뀔 때만 반영한다.
        if (width > 0) {
          setRenderWidth((prev) => (Math.abs(prev - width) > 1 ? width : prev));
        }
      }, 150);
    });
    observer.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      observer.disconnect();
    };
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
    penWidthRef.current = penWidth;
  }, [penWidth]);

  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);

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
          wasmUrl: WASM_URL,
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
          // 필기 캔버스는 화면 배율(dpr)만큼 더 촘촘한 버퍼로 만들어야 고해상도
          // 화면에서 획이 흐릿하게 늘어나 보이지 않는다(attachDrawing이 좌표/선굵기에
          // 같은 dpr을 곱해 그린다).
          annotationCanvas.width = cssWidth * dpr;
          annotationCanvas.height = cssHeight * dpr;
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
          attachDrawing({
            canvas: annotationCanvas,
            toolRef,
            penColorRef,
            zoomRef,
            penWidthRef,
            onPinchZoom: (factor) => onZoomChangeRef.current?.(factor),
          });

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
      className="relative h-full w-full overflow-auto bg-zinc-200 dark:bg-zinc-800"
    >
      {loading && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-5 bg-gradient-to-b from-blue-50 via-white to-white dark:from-blue-950/30 dark:via-zinc-900 dark:to-zinc-900">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <span className="absolute h-16 w-16 animate-ping rounded-full bg-blue-400/30" />
            <span className="relative flex h-14 w-14 animate-loading-float items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/30">
              <GraduationCap size={26} />
            </span>
          </div>
          <p
            key={messageIndex}
            className="animate-loading-fade-in px-4 text-center text-sm font-medium text-zinc-600 dark:text-zinc-400"
          >
            {LOADING_MESSAGES[messageIndex]}
          </p>
          <div className="h-1.5 w-36 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950/40">
            <div className="h-full w-1/3 animate-loading-bar rounded-full bg-blue-600" />
          </div>
        </div>
      )}
      {error && (
        <p className="whitespace-pre-wrap p-4 text-center text-sm text-red-600 dark:text-red-400">
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
