import { Canvas, Group, Path, Skia, type SkPath } from "@shopify/react-native-skia";
import { useMemo } from "react";

// 문제 위에 겹치는 필기 레이어(Skia). 웹 pdf-canvas-viewer.tsx 의 attachDrawing/redrawStrokes 와
// 같은 규칙: 획의 좌표·굵기는 전부 **콘텐츠 폭 대비 비율**(0~1)이라 확대/축소로 상자가 커지거나
// 작아져도 같은 자리에 같은 두께로 다시 그려진다(종이에 밴 잉크처럼). 경로는 실시간과 재그리기가
// 똑같이 — 첫 두 점은 직선, 그 뒤로는 중점끼리 잇는 2차 곡선(방식이 다르면 "필기가 흔들린다").
//
// 지우개는 destination-out(웹) ↔ Skia `layer` 그룹 안 `blendMode="clear"`: 이 레이어의 픽셀만
// 지우고 아래 문제 이미지에는 영향이 없다. 선폭 ERASER_LINE_WIDTH 24(웹 pdf-canvas-viewer.tsx:16).
//
// 터치 입력은 이 컴포넌트가 받지 않는다(pointerEvents none) — 제스처는 부모(single-question-view)가
// GestureDetector 로 잡아 normalized 점을 넘긴다. 줌/팬 변환도 부모의 Animated.View 가 이미지와
// 함께 걸어주므로 획이 항상 이미지에 붙어 있다.

export type DrawTool = "move" | "pen" | "eraser";

export const DEFAULT_PEN_WIDTH = 1.5;
export const PEN_WIDTH_PRESETS = [1, 2, 3.5];
export const ERASER_LINE_WIDTH = 24;

export type InkPoint = { x: number; y: number };

export type InkStroke = {
  erase: boolean;
  color: string;
  // 콘텐츠 폭 대비 비율.
  width: number;
  points: InkPoint[];
};

function mid(a: InkPoint, b: InkPoint): InkPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function buildStrokePath(points: InkPoint[], scale: number): SkPath {
  const path = Skia.Path.Make();
  if (points.length < 2) return path;
  const pts = points.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  path.moveTo(pts[0].x, pts[0].y);
  path.lineTo(pts[1].x, pts[1].y);
  if (pts.length > 2) {
    const start = mid(pts[0], pts[1]);
    path.moveTo(start.x, start.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const m = mid(pts[i], pts[i + 1]);
      path.quadTo(pts[i].x, pts[i].y, m.x, m.y);
    }
  }
  return path;
}

// 화면 픽셀 → 비율(콘텐츠 폭 기준). 굵기도 같은 기준으로 저장한다.
export function toNormalizedPoint(x: number, y: number, contentWidth: number): InkPoint {
  const w = contentWidth || 1;
  return { x: x / w, y: y / w };
}

export function normalizedWidth(tool: Exclude<DrawTool, "move">, penWidth: number, contentWidth: number) {
  return (tool === "eraser" ? ERASER_LINE_WIDTH : penWidth) / (contentWidth || 1);
}

function StrokePath({ stroke, scale }: { stroke: InkStroke; scale: number }) {
  const path = useMemo(() => buildStrokePath(stroke.points, scale), [stroke.points, scale]);
  if (stroke.points.length < 2) return null;
  return (
    <Path
      path={path}
      color={stroke.erase ? "#000000" : stroke.color}
      style="stroke"
      strokeWidth={stroke.width * scale}
      strokeCap="round"
      strokeJoin="round"
      blendMode={stroke.erase ? "clear" : "srcOver"}
    />
  );
}

export function InkLayer({
  width,
  height,
  strokes,
  live,
}: {
  // 콘텐츠 상자 크기(px). 비율 좌표에 width 를 곱해 그린다.
  width: number;
  height: number;
  strokes: InkStroke[];
  // 지금 긋고 있는 획(손을 떼면 strokes 로 확정).
  live: InkStroke | null;
}) {
  if (width <= 0 || height <= 0) return null;
  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width, height }} pointerEvents="none">
      {/* layer: 지우개의 clear 가 이 그룹(투명 배경) 안에서만 적용된다. */}
      <Group layer>
        {strokes.map((s, i) => (
          <StrokePath key={i} stroke={s} scale={width} />
        ))}
        {live && <StrokePath stroke={live} scale={width} />}
      </Group>
    </Canvas>
  );
}
