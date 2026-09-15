import { Canvas, Circle, SweepGradient, vec } from "@shopify/react-native-skia";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronDown, Trash2 } from "lucide-react-native";
import { useRef, useState } from "react";
import { Modal, Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";
import { PEN_WIDTH_PRESETS, type DrawTool } from "./ink-layer";

// 펜/지우개를 골랐을 때 헤더 아래 나타나는 색상·굵기·전체지우기 줄(웹 cbt-drawing-toolbar.tsx 1:1).
// 기본 3색 PEN_COLORS + 팔레트(PALETTE_PRESETS 14색 + 자체 HSV 피커: 채도/명도 사각형 + 색상
// 슬라이더, OS 컬러피커 대신) + 굵기 프리셋 [1, 2, 3.5] + "전체 지우기"(Trash2 14). tool 이 move 면
// 툴바 자체를 렌더하지 않는다. 팔레트·굵기 드롭다운은 투명 Modal 에 앵커 좌표로 띄운다(바깥 탭 → 닫힘).
export const PEN_COLORS = ["#111827", "#ef4444", "#2563eb"];

// 팔레트 트리거의 무지개 링(웹 RAINBOW_GRADIENT conic). Skia SweepGradient 가 conic 과 같다.
const RAINBOW_STOPS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#6366f1", "#ec4899", "#ef4444"];

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

const HUE_STOPS = ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff", "#ff0000"] as const;

// 색상환+명도 슬라이더에서 고른 값을 hex 로(웹 hsvToHex 그대로).
export function hsvToHex(h: number, s: number, v: number): string {
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

function hueToHex(h: number) {
  return hsvToHex(h, 1, 1);
}

const ChevronDownIcon = themedIcon(ChevronDown);
const TrashIcon = themedIcon(Trash2);

function RainbowRing({ size }: { size: number }) {
  const r = size / 2;
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Circle cx={r} cy={r} r={r}>
        <SweepGradient c={vec(r, r)} colors={RAINBOW_STOPS} />
      </Circle>
    </Canvas>
  );
}

// 선택 링(웹 ring-2 ring-offset-1 ring-zinc-400): 지름 +6 의 테두리 원으로 흉내 낸다.
function Ring({ active, size, children }: { active: boolean; size: number; children: React.ReactNode }) {
  return (
    <View
      style={{ width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }}
      className={["items-center justify-center border-2", active ? "border-zinc-400" : "border-transparent"].join(" ")}
    >
      {children}
    </View>
  );
}

// 앵커 아래 뜨는 드롭다운. 투명 Modal 이라 헤더 아래 콘텐츠 위로 자연히 겹치고, 바깥을 누르면 닫힌다.
function Popover({
  anchor,
  visible,
  onClose,
  align,
  children,
}: {
  anchor: { x: number; y: number; width: number; height: number } | null;
  visible: boolean;
  onClose: () => void;
  align: "left" | "center";
  children: React.ReactNode;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  if (!visible || !anchor) return null;
  const top = anchor.y + anchor.height + 4;
  const left =
    align === "center" ? anchor.x + anchor.width / 2 - size.width / 2 : anchor.x;
  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <Pressable accessibilityLabel="닫기" onPress={onClose} className="flex-1">
        <View
          onLayout={(e: LayoutChangeEvent) => setSize(e.nativeEvent.layout)}
          style={{ position: "absolute", top, left: Math.max(8, left), opacity: size.width ? 1 : 0 }}
          // 안쪽 탭은 닫히지 않게(팝오버 자체가 Pressable 을 삼킨다).
          onStartShouldSetResponder={() => true}
        >
          {children}
        </View>
      </Pressable>
    </Modal>
  );
}

type Anchor = { x: number; y: number; width: number; height: number };

export function DrawingToolbar({
  tool,
  penColor,
  onPenColorChange,
  penWidth,
  onPenWidthChange,
  onClearDrawing,
}: {
  tool: DrawTool;
  penColor: string;
  onPenColorChange: (color: string) => void;
  penWidth: number;
  onPenWidthChange: (width: number) => void;
  onClearDrawing: () => void;
}) {
  // 기본 3색 외에 팔레트에서 고른 색. 아직 안 골랐으면 null — 트리거는 무지개색 그대로.
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [widthMenuOpen, setWidthMenuOpen] = useState(false);
  const [paletteAnchor, setPaletteAnchor] = useState<Anchor | null>(null);
  const [widthAnchor, setWidthAnchor] = useState<Anchor | null>(null);
  const paletteRef = useRef<View>(null);
  const widthRef = useRef<View>(null);
  // 색상환 상태(되돌아왔을 때 손잡이 위치를 이어가려고 hue/채도/명도를 따로 든다).
  const [pickerHue, setPickerHue] = useState(265);
  const [pickerSat, setPickerSat] = useState(0.7);
  const [pickerVal, setPickerVal] = useState(0.85);
  const [squareSize, setSquareSize] = useState({ width: 1, height: 1 });
  const [sliderWidth, setSliderWidth] = useState(1);

  if (tool === "move") return null;

  function openPalette() {
    paletteRef.current?.measureInWindow((x, y, width, height) => {
      setPaletteAnchor({ x, y, width, height });
      setPaletteOpen(true);
    });
  }

  function openWidthMenu() {
    widthRef.current?.measureInWindow((x, y, width, height) => {
      setWidthAnchor({ x, y, width, height });
      setWidthMenuOpen(true);
    });
  }

  function applyPickerColor(hue: number, sat: number, val: number) {
    const hex = hsvToHex(hue, sat, val);
    setCustomColor(hex);
    onPenColorChange(hex);
  }

  function updateFromSquare(e: GestureResponderEvent) {
    const x = Math.min(1, Math.max(0, e.nativeEvent.locationX / squareSize.width));
    const y = Math.min(1, Math.max(0, e.nativeEvent.locationY / squareSize.height));
    setPickerSat(x);
    setPickerVal(1 - y);
    applyPickerColor(pickerHue, x, 1 - y);
  }

  function updateFromHueSlider(e: GestureResponderEvent) {
    const x = Math.min(1, Math.max(0, e.nativeEvent.locationX / sliderWidth));
    setPickerHue(x * 360);
    applyPickerColor(x * 360, pickerSat, pickerVal);
  }

  return (
    <View className="flex-row items-center gap-2 px-4 py-1.5">
      {tool === "pen" &&
        PEN_COLORS.map((color) => (
          <Pressable
            key={color}
            accessibilityRole="button"
            accessibilityLabel="펜 색상"
            accessibilityState={{ selected: penColor === color }}
            onPress={() => onPenColorChange(color)}
            className="shrink-0"
          >
            <Ring active={penColor === color} size={20}>
              <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: color }} />
            </Ring>
          </Pressable>
        ))}

      {tool === "pen" && (
        <View ref={paletteRef} collapsable={false} className="shrink-0">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="펜 팔레트 색상 선택"
            accessibilityState={{ expanded: paletteOpen }}
            onPress={openPalette}
          >
            <Ring active={!!customColor && penColor === customColor} size={20}>
              <View style={{ width: 20, height: 20 }} className="items-center justify-center">
                <View style={{ position: "absolute" }}>
                  <RainbowRing size={20} />
                </View>
                {customColor && (
                  <View
                    style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: customColor }}
                    className="border border-white dark:border-zinc-700"
                  />
                )}
              </View>
            </Ring>
          </Pressable>
        </View>
      )}

      {tool === "pen" && (
        <View ref={widthRef} collapsable={false} className="shrink-0 border-l border-zinc-200 pl-2 dark:border-zinc-700">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="펜 굵기 선택"
            accessibilityState={{ expanded: widthMenuOpen }}
            onPress={openWidthMenu}
            className="h-6 flex-row items-center gap-0.5 rounded-full px-1 active:bg-zinc-100 dark:active:bg-zinc-800"
          >
            <View
              className="rounded-full bg-zinc-500"
              style={{ width: penWidth + 2, height: penWidth + 2, borderRadius: penWidth + 2 }}
            />
            <View style={{ transform: [{ rotate: widthMenuOpen ? "180deg" : "0deg" }] }}>
              <ChevronDownIcon size={12} colorClassName="text-zinc-400 dark:text-zinc-600" />
            </View>
          </Pressable>
        </View>
      )}

      {tool === "eraser" && (
        <AppText variant="xs" className="shrink-0 text-zinc-400 dark:text-zinc-500">
          드래그한 부분만 지워져요
        </AppText>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="전체 지우기"
        onPress={onClearDrawing}
        className="ml-auto shrink-0 flex-row items-center gap-1 py-1"
      >
        <TrashIcon size={14} colorClassName="text-zinc-500 dark:text-zinc-500" />
      </Pressable>

      {/* 팔레트: 14색 프리셋 + 채도/명도 사각형 + 색상 슬라이더 */}
      <Popover anchor={paletteAnchor} visible={paletteOpen} onClose={() => setPaletteOpen(false)} align="left">
        <View className="w-52 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <View className="flex-row flex-wrap gap-1.5">
            {PALETTE_PRESETS.map((color) => (
              <Pressable
                key={color}
                accessibilityRole="button"
                accessibilityLabel="팔레트 색상"
                accessibilityState={{ selected: customColor === color }}
                onPress={() => {
                  setCustomColor(color);
                  onPenColorChange(color);
                  setPaletteOpen(false);
                }}
              >
                <Ring active={customColor === color} size={20}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: color }} />
                </Ring>
              </Pressable>
            ))}
          </View>

          <View
            onLayout={(e) => setSquareSize(e.nativeEvent.layout)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={updateFromSquare}
            onResponderMove={updateFromSquare}
            style={{ backgroundColor: hueToHex(pickerHue) }}
            className="relative mt-3 h-28 w-full overflow-hidden rounded-lg"
          >
            <LinearGradient
              colors={["#ffffff", "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ position: "absolute", inset: 0 }}
            />
            <LinearGradient
              colors={["rgba(0,0,0,0)", "#000000"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={{ position: "absolute", inset: 0 }}
            />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: pickerSat * squareSize.width - 8,
                top: (1 - pickerVal) * squareSize.height - 8,
                backgroundColor: customColor ?? PEN_COLORS[0],
              }}
              className="h-4 w-4 rounded-full border-2 border-white shadow"
            />
          </View>

          <View
            onLayout={(e) => setSliderWidth(e.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={updateFromHueSlider}
            onResponderMove={updateFromHueSlider}
            className="relative mt-3 h-3 w-full rounded-full"
          >
            <LinearGradient
              colors={HUE_STOPS}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ position: "absolute", inset: 0, borderRadius: 999 }}
            />
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: (pickerHue / 360) * sliderWidth - 8,
                top: -2,
                backgroundColor: hueToHex(pickerHue),
              }}
              className="h-4 w-4 rounded-full border-2 border-white shadow"
            />
          </View>
        </View>
      </Popover>

      {/* 굵기 프리셋 */}
      <Popover anchor={widthAnchor} visible={widthMenuOpen} onClose={() => setWidthMenuOpen(false)} align="center">
        <View className="items-center gap-1 rounded-full border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          {PEN_WIDTH_PRESETS.map((width) => (
            <Pressable
              key={width}
              accessibilityRole="button"
              accessibilityLabel={`펜 굵기 ${width}`}
              accessibilityState={{ selected: penWidth === width }}
              onPress={() => {
                onPenWidthChange(width);
                setWidthMenuOpen(false);
              }}
              className="h-7 w-7 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
            >
              <Ring active={penWidth === width} size={width + 2}>
                <View
                  className="rounded-full bg-zinc-500"
                  style={{ width: width + 2, height: width + 2, borderRadius: width + 2 }}
                />
              </Ring>
            </Pressable>
          ))}
        </View>
      </Popover>
    </View>
  );
}
