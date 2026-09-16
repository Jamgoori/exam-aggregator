import * as ScreenOrientation from "expo-screen-orientation";
import { ChevronLeft, ChevronRight, GraduationCap, ZoomIn, ZoomOut } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Pdf, { type PdfRef } from "react-native-pdf";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";
import {
  InkLayer,
  normalizedWidth,
  toNormalizedPoint,
  type DrawTool,
  type InkStroke,
} from "./ink-layer";
import { MAX_ZOOM, MIN_ZOOM, clampZoom } from "./single-question-view";

// 전체보기 = 웹 pdf-canvas-viewer.tsx(레이아웃·LOADING_MESSAGES·필기 모델)의 앱 판.
// Phase 1a 는 보기 전용이었고 Phase 2 에서 펜·지우개가 붙었다(설계서 §12 "CBT 전체보기 필기").
//
// ── 좌표 모델 (기기에서 디버깅할 사람에게) ─────────────────────────────────────────
// react-native-pdf 는 "페이지가 화면 어디에 그려졌는지"를 알려주지 않는다. 그래서 반대로
// **페이지가 어디에 있을지 우리가 정하고 네이티브를 거기에 가둔다.**
//
//  1) 뷰포트(왼쪽 영역) 크기를 onLayout 으로 재고(끌기 중 매 프레임 재렌더를 막으려 150ms
//     디바운스), onLoadComplete 가 준 PDF 페이지 크기(pt)에서 종횡비만 가져와
//     **페이지 상자** = (뷰포트 폭 × PAGE_OVERSAMPLE) × 그 종횡비 를 만든다.
//  2) 그 상자를 Pdf 의 style 로 그대로 준다(fitPolicy 0 = 폭 맞춤). 상자 종횡비가 페이지와
//     같으니 페이지는 상자를 정확히 채운다 — 위아래 여백(레터박스)이 생기지 않는다.
//     = 상자 좌상단이 곧 페이지 좌상단이다. 이게 이 화면의 유일한 기준점이다.
//  3) 네이티브 줌·스크롤은 잠근다(scale=minScale=maxScale=1, scrollEnabled=false, 더블탭 줌
//     off). 줌·팬은 Reanimated 공유값(displayScale·tx·ty)이 **[Pdf + Skia 잉크]를 하나의
//     Animated.View 로 같이** 변환한다. 둘이 같은 상자·같은 변환이라 획이 페이지에 붙어 있다.
//  4) 획은 **페이지 상자 기준 0~1 정규화 좌표**로 페이지 번호별로 저장한다
//     (x = e.x/상자폭, y = e.y/상자높이). RNGH 의 e.x/e.y 는 변환이 걸린 뷰의 *로컬* 좌표라
//     확대·이동 중에 그은 획도 보정 없이 그대로 들어간다. 굵기만은 웹과 같은 규칙으로
//     "줌 1 에서의 화면 dp" 기준(normalizedWidth(…, 뷰포트 폭))이라, 확대하면 종이에 밴 잉크처럼
//     같이 두꺼워진다. 화면이 커지거나(회전·분할 비율) 줌이 바뀌어도 상자에 곱하기만 하므로
//     획은 페이지 같은 자리에 남는다.
//  5) 페이지 크기를 모르는 동안(pageSize === null)에는 잉크 레이어를 아예 렌더하지 않는다 —
//     좌표계 없이 기록한 획은 페이지가 확정되는 순간 엉뚱한 자리로 튄다.
//
// onLoadComplete 는 **첫 쪽 크기**만 준다. 기출 PDF 는 전 쪽이 같은 규격이라 그 비율을 모든
// 쪽에 쓰지만, 쪽마다 크기가 다른 파일이면 그 쪽만 상자와 어긋난다(획도 같이 어긋난다).
//
// 페이지 넘김은 `singlePage` 가 아니라 `page` prop(네이티브 jumpTo)으로 한다. singlePage 는
// 문서를 한 장만 로드해서 페이지를 바꾸려면 통째로 다시 읽어야 하고(깜빡임·재다운로드),
// 지금 방식은 이미 로드된 문서 안에서 즉시 이동한다. 상자 크기가 바뀌면(분할 비율·회전)
// 네이티브가 스크롤 위치를 근사 복원하므로 setPage 로 현재 페이지를 다시 못 박는다.

// 로딩 중 순서대로 돌려 보여줄 문구(웹 LOADING_MESSAGES 그대로).
const LOADING_MESSAGES = [
  "시험지를 펼치는 중이에요",
  "문제를 한 장씩 준비하고 있어요",
  "합격까지 한 걸음, 곧 시작해요",
];
const MESSAGE_INTERVAL_MS = 2200;

// 페이지 상자를 뷰포트보다 몇 배 크게 잡을지 = 네이티브가 PDF 를 그리는 해상도 배수.
// 1 이면 변환 배율이 줌 그대로라 가장 안전하고 가볍다. 확대했을 때 글씨가 뭉개져 못 읽겠으면
// 2 로 올리면 선명해지지만 Skia 캔버스와 PDF 타일 캐시가 배수² 만큼 커진다(폭 400dp·3x 기기
// 기준 대략 32MB → 128MB). **실기기에서 선명도와 메모리를 보고 정할 값.**
const PAGE_OVERSAMPLE = 1;

// 분할선을 끄는 동안에는 폭이 매 프레임 바뀐다. 웹이 ResizeObserver 를 150ms 디바운스한 것과
// 같은 이유로(그대로 두면 PDF 재렌더가 쌓여 화면이 멈춘다) 상자는 폭이 멎은 뒤 한 번만 잡는다.
const RESIZE_SETTLE_MS = 150;

// 직전 점과 이만큼도 안 떨어졌으면 버린다(획 배열·리렌더 비용).
const MIN_POINT_DISTANCE = 0.002;

// 확대된 내용이 뷰포트 밖으로 완전히 도망가지 않도록 이동량을 가둔다. 변환 기준점이 상자
// 중심이라 허용 범위는 넘치는 크기의 절반이다(딱 맞거나 더 작으면 0 = 가운데 고정).
function clampTranslate(value: number, content: number, viewport: number): number {
  "worklet";
  const max = Math.max(0, (content - viewport) / 2);
  return Math.min(max, Math.max(-max, value));
}

const LogoIcon = themedIcon(GraduationCap);
const ZoomInIcon = themedIcon(ZoomIn);
const ZoomOutIcon = themedIcon(ZoomOut);
const PrevIcon = themedIcon(ChevronLeft);
const NextIcon = themedIcon(ChevronRight);

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
  tool,
  penColor,
  penWidth,
  page,
  onPageChange,
  strokes,
  onStrokeEnd,
}: {
  fileUrl: string;
  zoom: number;
  // 핀치로 바뀐 배율을 부모 zoom 상태에 되돌린다(버튼 표시와 어긋나지 않게).
  onZoomChange: (zoom: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  tool: DrawTool;
  penColor: string;
  penWidth: number;
  // 지금 보고 있는 PDF 페이지(1부터). 필기가 페이지별이라 솔버가 들고 있다.
  page: number;
  onPageChange: (page: number) => void;
  // 이 페이지의 확정 획.
  strokes: InkStroke[];
  onStrokeEnd: (page: number, stroke: InkStroke) => void;
}) {
  const [area, setArea] = useState({ width: 0, height: 0 });
  // PDF 페이지 크기(pt). 종횡비만 쓴다. null 이면 아직 좌표계가 없다 = 필기 금지.
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 그리는 중인 획의 렌더용 사본(공유값 → React 상태).
  const [live, setLive] = useState<InkStroke | null>(null);
  const pdfRef = useRef<PdfRef>(null);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 페이지 상자 ────────────────────────────────────────────────────────────
  const pageAspect =
    pageSize && pageSize.width > 0 && pageSize.height > 0 ? pageSize.height / pageSize.width : null;
  const boxWidth = area.width > 0 ? Math.round(area.width * PAGE_OVERSAMPLE) : 0;
  // 페이지 크기를 받기 전에는 뷰포트 비율로 임시 상자를 준다(그동안은 로딩 오버레이가 덮는다).
  const provisionalAspect = area.width > 0 ? area.height / area.width : 1;
  const boxHeight = boxWidth > 0 ? Math.round(boxWidth * (pageAspect ?? provisionalAspect)) : 0;
  // 상자를 뷰포트에 딱 맞추는 배율. PAGE_OVERSAMPLE 이 1 이면 1 이다.
  const fitScale = boxWidth > 0 ? area.width / boxWidth : 1;
  const ready = boxWidth > 0 && boxHeight > 0 && pageAspect !== null;

  // ── 제스처 상태(공유값은 useAnimatedStyle 보다 먼저 선언·대입해야 한다 — 훅에 잡힌 뒤에는
  //    immutability 규칙이 대입을 막는다. single-question-view 와 같은 이유) ───────────────
  const displayScale = useSharedValue(zoom);
  const savedScale = useSharedValue(zoom);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const liveStroke = useSharedValue<InkStroke | null>(null);

  // 전체보기만 가로 허용(설계서 §4.4 태블릿·가로) — 이탈 시 세로로 되돌린다.
  useEffect(() => {
    ScreenOrientation.unlockAsync().catch(() => {});
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  const onAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (resizeTimer.current) clearTimeout(resizeTimer.current);
    resizeTimer.current = setTimeout(() => {
      setArea((prev) =>
        Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1 ? prev : { width, height },
      );
    }, RESIZE_SETTLE_MS);
  }, []);

  useEffect(
    () => () => {
      if (resizeTimer.current) clearTimeout(resizeTimer.current);
    },
    [],
  );

  const commitZoom = useCallback(
    (next: number) => {
      onZoomChange(clampZoom(Math.round(next * 100) / 100));
    },
    [onZoomChange],
  );

  // 페이지를 넘기거나 좌표계가 처음 잡히면 그 페이지 맨 위부터 보여준다(웹에서 페이지 사이를
  // 스크롤해 내려온 것과 같은 자리). 가로는 가운데.
  // (useCallback 으로 감싸지 않는다 — 의존성 배열에 공유값을 넘기면 그 뒤로는
  //  react-hooks/immutability 가 제스처 콜백의 대입을 막는다.)
  function showPageTop() {
    const scale = zoom * fitScale;
    tx.value = 0;
    savedTx.value = 0;
    const top = Math.max(0, (boxHeight * scale - area.height) / 2);
    ty.value = top;
    savedTy.value = top;
  }

  // ── 줌·팬(뷰포트 전체에서 받는다) ────────────────────────────────────────────
  const pinch = Gesture.Pinch()
    .onBegin(() => {
      savedScale.value = displayScale.value;
    })
    .onUpdate((e) => {
      displayScale.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, savedScale.value * e.scale));
    })
    .onEnd(() => {
      runOnJS(commitZoom)(displayScale.value);
    });

  // 이동 도구면 한 손가락, 펜/지우개면 두 손가락일 때만 민다(한 손가락은 필기가 가져간다).
  const pan = Gesture.Pan()
    .minPointers(tool === "move" ? 1 : 2)
    .averageTouches(true)
    .onBegin(() => {
      // 줌·폭이 바뀌어 허용 범위가 줄었을 수 있다 — 시작값을 먼저 가둬야 "끌어도 한참 안 움직이는"
      // 구간이 생기지 않는다(화면에 보이는 위치는 늘 아래 stageStyle 이 가둔 값이다).
      const scale = displayScale.value * fitScale;
      savedTx.value = clampTranslate(tx.value, boxWidth * scale, area.width);
      savedTy.value = clampTranslate(ty.value, boxHeight * scale, area.height);
    })
    .onUpdate((e) => {
      const scale = displayScale.value * fitScale;
      tx.value = clampTranslate(savedTx.value + e.translationX, boxWidth * scale, area.width);
      ty.value = clampTranslate(savedTy.value + e.translationY, boxHeight * scale, area.height);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  // ── 필기(상자 위 Pan 이 포인터를 잡는다 — 문제별 보기와 같은 규칙) ──────────────
  const draw = Gesture.Pan()
    .enabled(tool !== "move" && ready)
    .minDistance(0)
    .maxPointers(1)
    .runOnJS(true)
    .onTouchesDown((e, state) => {
      // 두 번째 손가락이 닿는 순간부터 핀치로 취급하고, 진행 중이던 획은 버린다.
      if (e.numberOfTouches > 1) {
        liveStroke.value = null;
        setLive(null);
        state.fail();
      }
    })
    .onBegin((e) => {
      if (tool === "move" || !ready) return;
      const stroke: InkStroke = {
        erase: tool === "eraser",
        color: penColor,
        // 굵기는 "줌 1 에서의 화면 dp" 기준(= 뷰포트 폭) — 상자 배수와 무관하게 웹과 같은 굵기.
        width: normalizedWidth(tool, penWidth, area.width),
        points: [toNormalizedPoint(e.x, e.y, boxWidth, boxHeight)],
      };
      liveStroke.value = stroke;
      setLive(stroke);
    })
    .onUpdate((e) => {
      const cur = liveStroke.value;
      if (!cur || !ready) return;
      const p = toNormalizedPoint(e.x, e.y, boxWidth, boxHeight);
      const last = cur.points[cur.points.length - 1];
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < MIN_POINT_DISTANCE) return;
      const next: InkStroke = { ...cur, points: [...cur.points, p] };
      liveStroke.value = next;
      setLive(next);
    })
    .onFinalize(() => {
      const cur = liveStroke.value;
      liveStroke.value = null;
      setLive(null);
      // 점 하나짜리(움직이지 않은 탭)는 화면에도 아무것도 안 그려지므로 넘기지 않는다.
      if (cur && cur.points.length > 1) onStrokeEnd(page, cur);
    });

  // 버튼으로 바꾼 배율을 제스처 값에 반영(핀치 확정값과 반올림 차이만 나면 그대로 맞춘다).
  // 공유값은 의존성에 넣지 않는다(넣으면 immutability 규칙이 제스처의 대입을 막는다).
  useEffect(() => {
    if (Math.abs(displayScale.value - zoom) > 0.001) {
      displayScale.value = zoom;
      savedScale.value = zoom;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // 페이지가 바뀌거나 좌표계가 처음 잡힐 때만 맨 위로(줌을 바꿀 때는 보던 자리를 유지한다).
  useEffect(() => {
    showPageTop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, ready]);

  // 상자 크기가 바뀌면 네이티브가 스크롤 위치를 근사 복원한다 — 현재 페이지를 다시 못 박는다.
  useEffect(() => {
    if (!ready) return;
    const id = setTimeout(() => pdfRef.current?.setPage(page), 0);
    return () => clearTimeout(id);
  }, [ready, boxWidth, boxHeight, page]);

  const stageStyle = useAnimatedStyle(() => {
    const scale = displayScale.value * fitScale;
    return {
      transform: [
        { translateX: clampTranslate(tx.value, boxWidth * scale, area.width) },
        { translateY: clampTranslate(ty.value, boxHeight * scale, area.height) },
        { scale },
      ],
    };
  });

  const viewGesture = Gesture.Simultaneous(pinch, pan);

  return (
    <View className="relative min-h-0 flex-1 bg-zinc-200 dark:bg-zinc-800" onLayout={onAreaLayout}>
      <GestureDetector gesture={viewGesture}>
        <View className="min-h-0 flex-1 items-center justify-center overflow-hidden">
          {boxWidth > 0 && (
            <Animated.View style={[{ width: boxWidth, height: boxHeight }, stageStyle]}>
              {/* PDF 는 그림일 뿐 — 터치는 전부 우리 제스처가 받는다. */}
              <View pointerEvents="none" style={{ width: boxWidth, height: boxHeight }}>
                <Pdf
                  ref={pdfRef}
                  source={{ uri: fileUrl, cache: true }}
                  style={{ width: boxWidth, height: boxHeight, backgroundColor: "transparent" }}
                  page={page}
                  // 네이티브 줌·스크롤·더블탭 줌을 모두 잠근다(위 좌표 모델 3).
                  scale={1}
                  minScale={1}
                  maxScale={1}
                  scrollEnabled={false}
                  enablePaging={false}
                  enableDoubleTapZoom={false}
                  spacing={0}
                  fitPolicy={0}
                  enableAntialiasing
                  onLoadComplete={(numberOfPages, _path, size) => {
                    setPageCount(Math.max(1, numberOfPages));
                    if (size && size.width > 0 && size.height > 0) {
                      setPageSize({ width: size.width, height: size.height });
                    }
                    setLoading(false);
                  }}
                  onPageChanged={(current, numberOfPages) => {
                    setPageCount(Math.max(1, numberOfPages));
                    if (current >= 1 && current !== page) onPageChange(current);
                  }}
                  onError={(e) => {
                    setLoading(false);
                    setError(`PDF를 불러오지 못했어요.\n${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
                  }}
                />
              </View>
              {/* 페이지 크기를 알기 전에는 잉크 레이어 자체가 없다(좌표계 없는 획 금지). */}
              {ready && (
                <GestureDetector gesture={draw}>
                  <View style={{ position: "absolute", left: 0, top: 0, width: boxWidth, height: boxHeight }}>
                    <InkLayer
                      width={boxWidth}
                      height={boxHeight}
                      scaleY={boxHeight}
                      strokes={strokes}
                      live={live}
                    />
                  </View>
                </GestureDetector>
              )}
            </Animated.View>
          )}
        </View>
      </GestureDetector>

      {loading && <LoadingOverlay />}
      {error && (
        <View className="absolute inset-x-0 top-0 p-4">
          <AppText variant="sm" className="text-center text-red-600 dark:text-red-400" pretty>
            {error}
          </AppText>
        </View>
      )}

      {/* 웹은 전체 페이지를 이어서 스크롤하지만 앱은 한 장씩 보여준다(위 좌표 모델) — 페이지 이동 줄. */}
      {pageCount > 1 && (
        <View className="absolute bottom-3 left-3 flex-row items-center overflow-hidden rounded-full border border-zinc-200 bg-white/95 shadow-md dark:border-zinc-700 dark:bg-zinc-900/95">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="이전 페이지"
            accessibilityState={{ disabled: page <= 1 }}
            disabled={page <= 1}
            onPress={() => onPageChange(Math.max(1, page - 1))}
            className={[
              "items-center justify-center p-2.5 active:bg-zinc-100 dark:active:bg-zinc-800",
              page <= 1 ? "opacity-30" : "",
            ].join(" ")}
          >
            <PrevIcon size={20} colorClassName="text-zinc-600 dark:text-zinc-400" />
          </Pressable>
          <AppText variant="xs" weight="medium" tabular className="px-1 text-zinc-600 dark:text-zinc-400">
            {page} / {pageCount}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="다음 페이지"
            accessibilityState={{ disabled: page >= pageCount }}
            disabled={page >= pageCount}
            onPress={() => onPageChange(Math.min(pageCount, page + 1))}
            className={[
              "items-center justify-center p-2.5 active:bg-zinc-100 dark:active:bg-zinc-800",
              page >= pageCount ? "opacity-30" : "",
            ].join(" ")}
          >
            <NextIcon size={20} colorClassName="text-zinc-600 dark:text-zinc-400" />
          </Pressable>
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
