import { Canvas, Path, Skia, type SkPath } from "@shopify/react-native-skia";
import { useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Pdf from "react-native-pdf";
import { useColors } from "../theme/colors";

// ─────────────────────────────────────────────────────────────────────────────
// 전체 PDF 보기 + 펜 필기. 웹 pdf-canvas-viewer(pdf.js) 대체.
//
// 정렬 원리: react-native-pdf 는 페이지를 고정 박스(containerSize)에 렌더하고 네이티브
// 줌은 잠근다(scale 1, min=max). 줌/팬은 우리가 reanimated transform 으로 [페이지 +
// Skia 오버레이]를 함께 변환하므로 획이 페이지에 항상 붙어 있다. 획은 페이지 박스 기준
// 정규화 좌표(0~1)로 저장 → 확대해도 같은 위치.
//
// ⚠️ 기기 검증 필요: 터치 좌표·줌 한계·멀티페이지 전환 시 오버레이 동기화는 실기기에서
//   미세조정이 필요할 수 있다(이 환경에선 네이티브 빌드를 못 돌린다).
// ─────────────────────────────────────────────────────────────────────────────

export type PenTool = "move" | "pen" | "eraser";
export const PEN_COLORS = ["#ef4444", "#2563eb", "#111827", "#16a34a"];
export const DEFAULT_PEN_WIDTH = 3;

type Point = { x: number; y: number }; // 정규화 0~1
type Stroke = { color: string; width: number; points: Point[] };

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const ERASE_RADIUS = 0.025; // 정규화 거리 임계값

export function PdfPenViewer({ fileUrl }: { fileUrl: string }) {
  const colors = useColors();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [tool, setTool] = useState<PenTool>("move");
  const [color, setColor] = useState(PEN_COLORS[0]);
  const [width, setWidth] = useState(DEFAULT_PEN_WIDTH);

  // 페이지별 확정 획 + 그리는 중인 획.
  const [strokesByPage, setStrokesByPage] = useState<Record<number, Stroke[]>>({});
  const [drawing, setDrawing] = useState<Point[] | null>(null);
  const drawingRef = useRef<Point[]>([]);

  // 줌/팬 (move 모드) — 페이지+오버레이 공통 transform.
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  function onLayout(e: LayoutChangeEvent) {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize({ w, h });
  }

  const strokes = strokesByPage[page] ?? [];

  function commitStroke(points: Point[]) {
    if (points.length < 2) return;
    setStrokesByPage((prev) => ({
      ...prev,
      [page]: [...(prev[page] ?? []), { color, width, points }],
    }));
  }

  function eraseAt(p: Point) {
    setStrokesByPage((prev) => {
      const list = prev[page] ?? [];
      const kept = list.filter(
        (s) =>
          !s.points.some(
            (q) => Math.hypot(q.x - p.x, q.y - p.y) < ERASE_RADIUS,
          ),
      );
      if (kept.length === list.length) return prev;
      return { ...prev, [page]: kept };
    });
  }

  function clearPage() {
    setStrokesByPage((prev) => ({ ...prev, [page]: [] }));
  }

  // ── 제스처 ──────────────────────────────────────────────
  // move 모드: 핀치 줌 + 드래그 팬. pen/eraser 모드: 그리기/지우기(줌·팬 잠금).
  const pinch = Gesture.Pinch()
    .enabled(tool === "move")
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const panMove = Gesture.Pan()
    .enabled(tool === "move")
    .minPointers(1)
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  // 그리기/지우기: 오버레이 로컬 좌표(transform 영향 안 받음)를 정규화해 사용.
  const draw = Gesture.Pan()
    .enabled(tool !== "move")
    .runOnJS(true)
    .onBegin((e) => {
      if (!size.w || !size.h) return;
      const p = { x: e.x / size.w, y: e.y / size.h };
      if (tool === "eraser") {
        eraseAt(p);
        return;
      }
      drawingRef.current = [p];
      setDrawing([p]);
    })
    .onUpdate((e) => {
      if (!size.w || !size.h) return;
      const p = { x: e.x / size.w, y: e.y / size.h };
      if (tool === "eraser") {
        eraseAt(p);
        return;
      }
      // 포인트 샘플링: 직전 점과 너무 가까우면 버려 획 배열·리렌더 비용을 줄인다.
      const last = drawingRef.current[drawingRef.current.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.004) return;
      drawingRef.current = [...drawingRef.current, p];
      setDrawing(drawingRef.current.slice());
    })
    .onEnd(() => {
      if (tool === "pen") commitStroke(drawingRef.current);
      drawingRef.current = [];
      setDrawing(null);
    });

  const composed = Gesture.Simultaneous(pinch, panMove, draw);

  // 확정된 획의 SkPath 는 획 목록/크기가 바뀔 때만 다시 만든다. 그리는 중(setDrawing)엔
  // strokes 참조가 그대로라 이 memo 가 재사용돼, 매 포인트마다 기존 획 전체를 재생성하던
  // 비용이 사라진다(그리는 중엔 in-progress 획 하나만 새로 만든다).
  const committedPaths = useMemo(
    () =>
      strokes.map((s) => ({
        path: buildPath(s.points, size.w, size.h),
        color: s.color,
        width: s.width,
      })),
    [strokes, size.w, size.h],
  );

  const wrapperStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  function resetZoom() {
    scale.value = withTiming(1);
    savedScale.value = 1;
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
  }

  return (
    <View style={{ flex: 1 }}>
      <Toolbar
        tool={tool}
        onTool={setTool}
        color={color}
        onColor={setColor}
        width={width}
        onWidth={setWidth}
        onClear={clearPage}
        onResetZoom={resetZoom}
        page={page}
        pageCount={pageCount}
        onPrev={() => setPage((p) => Math.max(1, p - 1))}
        onNext={() => setPage((p) => Math.min(pageCount, p + 1))}
      />

      <View style={{ flex: 1, overflow: "hidden" }} onLayout={onLayout}>
        <GestureDetector gesture={composed}>
          <Animated.View style={[{ flex: 1 }, wrapperStyle]}>
            {size.w > 0 && (
              <Pdf
                source={{ uri: fileUrl, cache: true }}
                page={page}
                singlePage
                scale={1}
                minScale={1}
                maxScale={1}
                enablePaging={false}
                fitPolicy={0}
                onLoadComplete={(n: number) => setPageCount(n)}
                style={{ flex: 1, backgroundColor: colors.bg }}
              />
            )}
            {/* Skia 오버레이 — 페이지와 같은 박스, 같은 transform 아래라 획이 붙어 있다. */}
            {size.w > 0 && (
              <Canvas
                style={{ position: "absolute", left: 0, top: 0, width: size.w, height: size.h }}
                pointerEvents="none"
              >
                {committedPaths.map((s, i) => (
                  <Path
                    key={i}
                    path={s.path}
                    color={s.color}
                    style="stroke"
                    strokeWidth={s.width}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                ))}
                {drawing && (
                  <Path
                    path={buildPath(drawing, size.w, size.h)}
                    color={color}
                    style="stroke"
                    strokeWidth={width}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                )}
              </Canvas>
            )}
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

function buildPath(points: Point[], w: number, h: number): SkPath {
  const path = Skia.Path.Make();
  if (points.length > 0) {
    path.moveTo(points[0].x * w, points[0].y * h);
    for (let i = 1; i < points.length; i++) {
      path.lineTo(points[i].x * w, points[i].y * h);
    }
  }
  return path;
}

function Toolbar({
  tool,
  onTool,
  color,
  onColor,
  width,
  onWidth,
  onClear,
  onResetZoom,
  page,
  pageCount,
  onPrev,
  onNext,
}: {
  tool: PenTool;
  onTool: (t: PenTool) => void;
  color: string;
  onColor: (c: string) => void;
  width: number;
  onWidth: (w: number) => void;
  onClear: () => void;
  onResetZoom: () => void;
  page: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        paddingHorizontal: 10,
        paddingVertical: 8,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {(["move", "pen", "eraser"] as PenTool[]).map((t) => (
          <ToolButton
            key={t}
            label={t === "move" ? "이동" : t === "pen" ? "펜" : "지우개"}
            active={tool === t}
            onPress={() => onTool(t)}
          />
        ))}
        <View style={{ flex: 1 }} />
        <ToolButton label="맞춤" active={false} onPress={onResetZoom} />
        <ToolButton label="지우기" active={false} onPress={onClear} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {/* 펜 색 */}
        <View style={{ flexDirection: "row", gap: 6 }}>
          {PEN_COLORS.map((c) => (
            <Pressable
              key={c}
              onPress={() => onColor(c)}
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: c,
                borderWidth: color === c ? 3 : 1,
                borderColor: color === c ? colors.text : colors.border,
              }}
            />
          ))}
        </View>
        {/* 굵기 */}
        <View style={{ flexDirection: "row", gap: 6 }}>
          {[2, 3, 5].map((w) => (
            <Pressable
              key={w}
              onPress={() => onWidth(w)}
              style={{
                width: 28,
                height: 24,
                borderRadius: 6,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: width === w ? colors.primary : colors.border,
              }}
            >
              <View
                style={{
                  width: 16,
                  height: w,
                  borderRadius: w,
                  backgroundColor: colors.text,
                }}
              />
            </Pressable>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        {/* 페이지 이동 */}
        <ToolButton label="◀" active={false} onPress={onPrev} disabled={page <= 1} />
        <Text style={{ fontSize: 12, color: colors.textMuted, minWidth: 44, textAlign: "center" }}>
          {page} / {pageCount}
        </Text>
        <ToolButton label="▶" active={false} onPress={onNext} disabled={page >= pageCount} />
      </View>
    </View>
  );
}

function ToolButton({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: active ? colors.primary : colors.card,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ color: active ? colors.primaryText : colors.text, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}
