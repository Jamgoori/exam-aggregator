import * as ScreenOrientation from "expo-screen-orientation";
import { GraduationCap, ZoomIn, ZoomOut } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Pdf from "react-native-pdf";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { AppText } from "../app-text";
import { kvGet } from "../../lib/kv";
import { themedIcon } from "../../theme/icons";
import { MAX_ZOOM, MIN_ZOOM, clampZoom } from "./single-question-view";

// 전체보기(웹 pdf-canvas-viewer.tsx 의 레이아웃·LOADING_MESSAGES 만). Phase 1a 는 **PDF 보기 전용**
// (react-native-pdf 7, 네이티브 핀치) + OMR 바텀시트(솔버가 든다). 좌우 분할 OMR(kv
// `cbt:omr-split-ratio`)·Skia 펜(PdfPenViewer)은 Phase 2 — 아래 TODO.
// 배율 버튼은 웹과 같은 ZOOM_STEP/MIN/MAX 로 Pdf 의 scale 을 조절한다.
//
// TODO(Phase 2): 좌우 분할 OMR(0.42, 0.3–0.7, 구분선 w-3 + 핸들, PanelRightClose 16) + SkiaInkLayer
// 페이지 오버레이(react-native-pdf 는 페이지 좌표를 주지 않아 singlePage + 자체 줌/팬으로 재구성).

// 로딩 중 순서대로 돌려 보여줄 문구(웹 LOADING_MESSAGES 그대로).
const LOADING_MESSAGES = [
  "시험지를 펼치는 중이에요",
  "문제를 한 장씩 준비하고 있어요",
  "합격까지 한 걸음, 곧 시작해요",
];
const MESSAGE_INTERVAL_MS = 2200;

// 웹 lib/cbt-omr-split.ts 와 같은 값. Phase 2 분할 패널이 쓴다 — 키(kv)와 범위만 미리 지킨다.
export const OMR_SPLIT = { default: 0.42, min: 0.3, max: 0.7 } as const;

export function clampOmrSplit(ratio: number): number {
  if (!Number.isFinite(ratio)) return OMR_SPLIT.default;
  return Math.min(OMR_SPLIT.max, Math.max(OMR_SPLIT.min, ratio));
}

// 저장된 분할 비율(웹 localStorage 키 그대로 kv `cbt:omr-split-ratio`). Phase 1a 는 읽기만 한다.
export async function readOmrSplitRatio(): Promise<number> {
  const raw = await kvGet("cbt:omr-split-ratio");
  return raw ? clampOmrSplit(Number.parseFloat(raw)) : OMR_SPLIT.default;
}

const LogoIcon = themedIcon(GraduationCap);
const ZoomInIcon = themedIcon(ZoomIn);
const ZoomOutIcon = themedIcon(ZoomOut);

// 웹 loading-float 2.2s / loading-bar 1.6s / 문구 2200ms 순환(설계서 §4.3 모션 표).
function LoadingOverlay() {
  const reduce = useReducedMotion();
  const [messageIndex, setMessageIndex] = useState(0);
  const float = useSharedValue(0);
  const bar = useSharedValue(-1);

  useEffect(() => {
    const id = setInterval(() => setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length), MESSAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (reduce) return;
    float.value = withRepeat(
      withSequence(
        withTiming(-6, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    bar.value = withRepeat(withTiming(3, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, false);
  }, [reduce, float, bar]);

  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: float.value }] }));
  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateX: bar.value * 48 }] }));

  return (
    <View className="absolute inset-0 z-10 items-center justify-center gap-5 bg-white dark:bg-zinc-900">
      <View className="h-16 w-16 items-center justify-center">
        <View className="absolute h-16 w-16 rounded-full bg-blue-400/30" />
        <Animated.View
          style={floatStyle}
          className="h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/30"
        >
          <LogoIcon size={26} colorClassName="text-white" />
        </Animated.View>
      </View>
      <AppText key={messageIndex} variant="sm" weight="medium" className="px-4 text-center text-zinc-600 dark:text-zinc-400">
        {LOADING_MESSAGES[messageIndex]}
      </AppText>
      <View className="h-1.5 w-36 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-950/40">
        <Animated.View style={barStyle} className="h-full w-12 rounded-full bg-blue-600" />
      </View>
    </View>
  );
}

export function FullView({
  fileUrl,
  zoom,
  onZoomChange,
  onZoomIn,
  onZoomOut,
}: {
  fileUrl: string;
  zoom: number;
  // 네이티브 핀치로 바뀐 배율을 부모 zoom 상태에 되돌린다(버튼 표시와 어긋나지 않게).
  onZoomChange: (zoom: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 전체보기만 가로 허용(설계서 §4.4 태블릿·가로) — 이탈 시 세로로 되돌린다.
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  return (
    <View className="relative flex-1 bg-zinc-200 dark:bg-zinc-800">
      <Pdf
        source={{ uri: fileUrl, cache: true }}
        style={{ flex: 1, backgroundColor: "transparent" }}
        scale={zoom}
        minScale={MIN_ZOOM}
        maxScale={MAX_ZOOM}
        spacing={8}
        fitPolicy={0}
        enableAntialiasing
        enableDoubleTapZoom
        onLoadComplete={() => setLoading(false)}
        onScaleChanged={(s) => onZoomChange(clampZoom(Math.round(s * 100) / 100))}
        onError={(e) => {
          setLoading(false);
          setError(`PDF를 불러오지 못했어요.\n${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
        }}
      />
      {loading && <LoadingOverlay />}
      {error && (
        <View className="absolute inset-x-0 top-0 p-4">
          <AppText variant="sm" className="text-center text-red-600 dark:text-red-400" pretty>
            {error}
          </AppText>
        </View>
      )}
      {/* 모바일은 헤더가 좁아 시험지 위에 떠 있는 줌 컨트롤(웹 lg:hidden 블록). */}
      <View className="absolute bottom-3 right-3 overflow-hidden rounded-full border border-zinc-200 bg-white/95 shadow-md dark:border-zinc-700 dark:bg-zinc-900/95">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="시험지 확대"
          accessibilityState={{ disabled: zoom >= MAX_ZOOM }}
          disabled={zoom >= MAX_ZOOM}
          onPress={onZoomIn}
          className={["items-center justify-center p-2.5 active:bg-zinc-100 dark:active:bg-zinc-800", zoom >= MAX_ZOOM ? "opacity-30" : ""].join(" ")}
        >
          <ZoomInIcon size={20} colorClassName="text-zinc-600 dark:text-zinc-400" />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="시험지 축소"
          accessibilityState={{ disabled: zoom <= MIN_ZOOM }}
          disabled={zoom <= MIN_ZOOM}
          onPress={onZoomOut}
          className={[
            "items-center justify-center border-t border-zinc-200 p-2.5 active:bg-zinc-100 dark:border-zinc-700 dark:active:bg-zinc-800",
            zoom <= MIN_ZOOM ? "opacity-30" : "",
          ].join(" ")}
        >
          <ZoomOutIcon size={20} colorClassName="text-zinc-600 dark:text-zinc-400" />
        </Pressable>
      </View>
    </View>
  );
}
