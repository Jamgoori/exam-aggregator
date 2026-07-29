"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { DrawTool } from "@/components/pdf-canvas-viewer";

// CBT 문제별 풀기(SingleQuestionView)와 오답 다시 풀기(ReviewSolver)가 공유하는
// "문항 한 장을 화면에 맞춰 보여주고 손가락으로 조작하는" 규칙. 두 화면은 붙어 있는
// 정보(출처·정답 공개 여부·제출 버튼)만 다를 뿐, 문제를 넘기고 확대하는 조작감은
// 같아야 해서 여기 한 곳에 둔다 — 한쪽만 고쳐져 조작감이 갈라지는 걸 막는 게 목적.

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.1;

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// 문제별 보기에서 zoom 100%일 때 문제 이미지가 차지하는 최대 너비(px). 전체보기와
// 같은 max-w-2xl(672px)로 두면 PC에서 문항 하나가 지나치게 크게 보인다.
// 모바일 화면 폭보다 넉넉히 커서, 좁은 화면에서는 예전처럼 화면 전체를 채운다.
//
// 여기서 더 줄이면 화질이 눈에 띄게 나빠진다: 전체보기는 PDF를 벡터로 다시 그려서
// 어떤 배율이든 선명하지만, 문제별 보기는 미리 잘라둔 래스터(webp, 원본 폭 약 877px)라
// 표시 폭을 줄인 만큼 글자 획에 쓸 픽셀이 그대로 사라진다. 672px일 때 0.77배 축소,
// 605px면 0.69배, 538px(80%)까지 내리면 0.61배까지 떨어지면서 1x 화면에서 얇은 획이
// 회색으로 뭉개진다. 크롭을 더 높은 해상도로 다시 떠도 글자가 작아지는 것 자체는
// 그대로라, 이 값은 "크기 vs 가독성" 절충점이지 화질로 보완할 수 있는 값이 아니다.
export const BASE_CONTENT_WIDTH = 605;

// 세로가 짧은 태블릿 가로에서 "높이에 맞춰 폭을 역산"할 때, 세로로 아주 긴
// 문제(자료해석 세트 등)까지 한 화면에 욱여넣으면 글자가 못 읽을 만큼 작아진다.
// 그 지점부터는 차라리 이 폭으로 멈추고 스크롤을 허용하는 게 낫다는 하한선.
const MIN_FIT_WIDTH = 300;

// 배율 상태와 그걸 조절하는 입력(버튼, 핀치)을 묶은 훅. 트랙패드 핀치/Ctrl+휠은
// 전체보기(PDF)에만 필요해서 여기 두지 않고 cbt-solver가 따로 감싼다.
export function useContentZoom() {
  const [zoom, setZoom] = useState(1);

  function zoomIn() {
    setZoom((z) => clampZoom(Math.round((z + ZOOM_STEP) * 100) / 100));
  }

  function zoomOut() {
    setZoom((z) => clampZoom(Math.round((z - ZOOM_STEP) * 100) / 100));
  }

  // factor는 직전 대비 손가락 간격 변화 비율(예: 1.02)이라 그대로 곱해서 반영한다.
  function handlePinchZoom(factor: number) {
    setZoom((z) => clampZoom(Math.round(z * factor * 100) / 100));
  }

  return { zoom, setZoom, zoomIn, zoomOut, handlePinchZoom };
}

// 폭 고정(605) 대신, 세로가 병목일 때는 스크롤 영역 높이에 맞는 폭을 역산해서
// 문제 전체가 스크롤 없이 한 화면에 담기게 한다. 세로 여유가 많은 세로모드에서는
// fitWidth가 605보다 커서 min(605, …)에 걸려 기존과 동일하게 보인다. 이미지 자연
// 비율(세로/가로)의 합이 곧 "폭 1px당 총 높이"라, 쓸 수 있는 높이를 그 합으로
// 나누면 그 높이에 맞는 폭이 나온다. 너무 세로로 긴 문제는 MIN_FIT_WIDTH에서 멈추고
// 그 아래로는 스크롤을 허용한다(작아서 못 읽느니 스크롤이 낫다).
export function useFitContentWidth({
  scrollAreaRef,
  itemKey,
  imageCount,
  zoom,
}: {
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  // 문항이 바뀐 걸 알아채는 키(문항 번호·인덱스 등). 바뀌면 잰 비율을 버린다.
  itemKey: number;
  imageCount: number;
  zoom: number;
}) {
  // "높이에 맞춰 폭 역산"에 필요한 두 값: 문제가 들어갈 스크롤 영역의 실제 높이와,
  // 각 이미지의 세로/가로 비율(자연 크기 기준). 문항을 넘기면 이미지가 바뀌므로
  // 비율은 매번 새로 잰다.
  const [availableHeight, setAvailableHeight] = useState(0);
  const [aspectRatios, setAspectRatios] = useState<number[]>([]);
  // 마지막으로 확정된 문제 폭. 문항을 넘기는 순간 새 이미지 비율을 아직 못 재는
  // 한 프레임 동안, 폭을 605로 되돌리는 대신 이 값을 유지해 폭이 확 튀며 깜빡이는
  // 걸 막는다(새 이미지 onLoad가 끝나면 자연스럽게 새 폭으로 이어진다).
  const [stableBaseWidth, setStableBaseWidth] = useState(BASE_CONTENT_WIDTH);
  // 문항이 바뀌면 이미지가 통째로 달라지므로 이전 문항에서 잰 비율을 버린다. 이펙트
  // 대신 렌더 중에 변화를 감지해 초기화하는 React 권장 패턴이다. 비운 직후엔
  // 새 비율을 못 재지만, 폭은 stableBaseWidth로 이어져 깜빡이지 않는다.
  const [measuredKey, setMeasuredKey] = useState(itemKey);
  if (measuredKey !== itemKey) {
    setMeasuredKey(itemKey);
    setAspectRatios([]);
  }

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;
    setAvailableHeight(scrollArea.clientHeight);
    const observer = new ResizeObserver(() =>
      setAvailableHeight(scrollArea.clientHeight),
    );
    observer.observe(scrollArea);
    return () => observer.disconnect();
  }, [scrollAreaRef]);

  const totalAspect = aspectRatios.reduce((sum, r) => sum + r, 0);
  const allImagesMeasured =
    imageCount > 0 &&
    aspectRatios.length === imageCount &&
    aspectRatios.every((r) => r > 0);
  // 스크롤 영역의 세로 패딩(py-4 = 32px), 이미지 사이 간격(gap-2 = 8px), 컨테이너
  // 테두리(위아래 1px) + 반올림 여유를 빼야 실제로 이미지가 쓸 수 있는 높이가 된다.
  const usableHeight = availableHeight - 32 - 8 * Math.max(0, imageCount - 1) - 4;
  const measuredBaseWidth =
    allImagesMeasured && usableHeight > 0 && totalAspect > 0
      ? Math.min(BASE_CONTENT_WIDTH, Math.max(MIN_FIT_WIDTH, usableHeight / totalAspect))
      : null;
  // 새로 잰 폭이 있으면 그 값을 쓰고, 없으면(문항 전환 직후) 마지막 폭을 유지한다.
  if (measuredBaseWidth !== null && measuredBaseWidth !== stableBaseWidth) {
    setStableBaseWidth(measuredBaseWidth);
  }

  // 이미지가 로드될 때마다 자연 비율을 기록한다(<img onLoad>에 그대로 연결).
  function handleImageLoad(index: number, img: HTMLImageElement) {
    if (!img.naturalWidth) return;
    const ratio = img.naturalHeight / img.naturalWidth;
    setAspectRatios((prev) => {
      if (prev[index] === ratio) return prev;
      const next = [...prev];
      next[index] = ratio;
      return next;
    });
  }

  return {
    contentWidth: Math.round((measuredBaseWidth ?? stableBaseWidth) * zoom),
    handleImageLoad,
  };
}

// 문제지 영역을 좌우로 쓸어넘기면 이전/다음 문제로 이동한다. 펜·지우개가 켜져
// 있을 때는 획을 긋는 동작과 겹치므로 동작하지 않고(이동 모드에서만), 세로
// 스크롤과 헷갈리지 않도록 가로 이동이 충분히 크고 우세할 때만 넘긴다.
//
// 이동 모드에서 캔버스는 pointerEvents:none이라 attachDrawing의 핀치가 안 먹는다.
// 그래서 이동 모드의 두 손가락 핀치는 여기 스크롤 영역 터치로 직접 잡아 확대/축소로
// 넘긴다(펜/지우개 모드에서는 캔버스가 pointer로 잡으므로 여기서는 무시).
export function useSwipeNavigation({
  tool,
  onPrev,
  onNext,
  onPinchZoom,
}: {
  tool: DrawTool;
  onPrev: () => void;
  onNext: () => void;
  onPinchZoom?: (factor: number) => void;
}) {
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const pinchDistRef = useRef<number | null>(null);

  function twoFingerDistance(touches: React.TouchList) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function onTouchStart(e: React.TouchEvent) {
    if (tool === "move" && e.touches.length === 2) {
      swipeStart.current = null;
      pinchDistRef.current = twoFingerDistance(e.touches);
      return;
    }
    if (tool !== "move" || e.touches.length !== 1) {
      swipeStart.current = null;
      return;
    }
    swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }

  function onTouchMove(e: React.TouchEvent) {
    if (tool === "move" && e.touches.length === 2 && pinchDistRef.current !== null) {
      const distance = twoFingerDistance(e.touches);
      if (pinchDistRef.current > 0) onPinchZoom?.(distance / pinchDistRef.current);
      pinchDistRef.current = distance;
      swipeStart.current = null;
      return;
    }
    // 도중에 손가락이 더 닿으면(핀치 등) 스와이프로 취급하지 않는다.
    if (e.touches.length > 1) swipeStart.current = null;
  }

  function onTouchEnd(e: React.TouchEvent) {
    // 손가락이 하나 이하로 줄면 핀치 추적을 끝낸다.
    if (e.touches.length < 2) pinchDistRef.current = null;
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || tool !== "move") return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) onNext();
    else onPrev();
  }

  return { onTouchStart, onTouchMove, onTouchEnd };
}
