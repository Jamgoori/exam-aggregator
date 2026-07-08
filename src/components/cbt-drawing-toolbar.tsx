"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { PEN_WIDTH_PRESETS, type DrawTool } from "@/components/pdf-canvas-viewer";

export const PEN_COLORS = ["#111827", "#ef4444", "#2563eb"];

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

// 드롭다운이 열려 있을 때 바깥을 누르면 닫는다.
function useCloseOnOutsideClick(
  open: boolean,
  ref: RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
    // ref/onClose는 매 렌더 동일하게 동작하는 값이라 open 변화에만 반응하면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

// 펜/지우개 도구를 골랐을 때 헤더 아래에 나타나는 색상·굵기·전체지우기 줄.
// 색상 팔레트(프리셋 + 자체 제작 색상환 피커)와 굵기 드롭다운의 상태는 전부 이
// 컴포넌트가 들고 있고, 부모에는 최종 선택된 색/굵기만 올려보낸다.
export function CbtDrawingToolbar({
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
  // 기본 3색 외에 팔레트에서 고른 색. 아직 한 번도 안 골랐으면 null이고, 트리거
  // 아이콘은 그동안 무지개색 그대로 보여준다(첫 사용자에게 "여기서 더 고를 수
  // 있다"는 신호). 한 번 고르고 나면 그 색을 계속 기억해서 다시 보여준다.
  const [customColor, setCustomColor] = useState<string | null>(null);
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

  useCloseOnOutsideClick(widthMenuOpen, widthMenuRef, () => setWidthMenuOpen(false));
  useCloseOnOutsideClick(paletteOpen, paletteMenuRef, () => setPaletteOpen(false));

  function applyPickerColor(hue: number, sat: number, val: number) {
    const hex = hsvToHex(hue, sat, val);
    setCustomColor(hex);
    onPenColorChange(hex);
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

  if (tool === "move") return null;

  return (
    <div>
      <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-1.5">
        {tool === "pen" &&
          PEN_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label="펜 색상"
              onClick={() => onPenColorChange(color)}
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
                        onPenColorChange(color);
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
                      onPenWidthChange(width);
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
          onClick={onClearDrawing}
          aria-label="전체 지우기"
          className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-zinc-500 hover:text-zinc-700"
        >
          <Trash2 size={14} />
          <span className="hidden sm:inline">전체 지우기</span>
        </button>
      </div>
    </div>
  );
}
