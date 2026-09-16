import { useQueryClient } from "@tanstack/react-query";
import { Image, type ImageLoadEventData } from "expo-image";
import { Check, ChevronLeft, ChevronRight } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";
import {
  DEFAULT_PEN_WIDTH,
  InkLayer,
  normalizedWidth,
  toNormalizedPoint,
  type DrawTool,
  type InkStroke,
} from "./ink-layer";
import type { CbtQuestionResult } from "./use-cbt-state";

// 문제별 보기 한 화면(웹 single-question-view.tsx + question-view-gestures.ts 1:1).
//
// 배율: 웹처럼 CSS transform 이 아니라 문제 영역의 실제 너비를 키운다 — contentWidth =
// min(스크롤 영역 폭, round(base × zoom)). base 는 BASE_CONTENT_WIDTH(605) 를 상한으로, 세로가
// 병목이면 이미지 비율의 합으로 "높이에 맞는 폭"을 역산(MIN_FIT_WIDTH 300 하한). 필기 좌표는 폭
// 대비 비율이라 폭이 바뀌어도 같은 자리에 남는다. 핀치 중에는 Reanimated 공유값으로 상자
// (이미지+잉크)를 함께 살짝 키워 보여주고, 손을 떼는 순간 웹 handlePinchZoom 처럼 배율을 곱해
// 확정한다(ZOOM_STEP 0.1, MIN 0.5, MAX 2.5 는 부모 useContentZoom).
//
// 제스처: 스와이프 = move 도구에서만 |dx| ≥ 60 && |dx| ≥ 1.5|dy|, 두 손가락이 닿으면 취소.
// 펜/지우개는 상자 위 Pan 이 포인터를 잡고(스크롤 대신 필기), 두 번째 손가락이 닿으면 긋던 획을
// 버리고 핀치로 넘긴다.
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.5;
export const ZOOM_STEP = 0.1;
export const BASE_CONTENT_WIDTH = 605;
const MIN_FIT_WIDTH = 300;
const SWIPE_MIN_DX = 60;
const SWIPE_DX_OVER_DY = 1.5;
// 스크롤 영역 안쪽 여백(웹 px-4 py-4) 과 이미지 간격(gap-2).
const AREA_PADDING = 16;
const IMAGE_GAP = 8;

export function clampZoom(zoom: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

// 배율 상태와 그걸 조절하는 입력(버튼·핀치). 웹 useContentZoom.
export function useContentZoom() {
  const [zoom, setZoom] = useState(1);
  const zoomIn = useCallback(() => setZoom((z) => clampZoom(Math.round((z + ZOOM_STEP) * 100) / 100)), []);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(Math.round((z - ZOOM_STEP) * 100) / 100)), []);
  // factor 는 직전 대비 배율(핀치 시작 → 끝)이라 그대로 곱한다.
  const handlePinchZoom = useCallback(
    (factor: number) => setZoom((z) => clampZoom(Math.round(z * factor * 100) / 100)),
    [],
  );
  return { zoom, setZoom, zoomIn, zoomOut, handlePinchZoom };
}

export type QuestionAnswerState = {
  number: number;
  choiceCount: number;
  selected: number | null;
  onSelect: (choice: number) => void;
  questionResult: Pick<CbtQuestionResult, "selected_choice" | "is_correct"> | null;
};

const PrevIcon = themedIcon(ChevronLeft);
const NextIcon = themedIcon(ChevronRight);
const CheckIcon = themedIcon(Check);

type Dims = { width: number; height: number };

// 이미지 크기는 DB 에 없어(question_images 에 width/height 없음) onLoad 로 실측하고 ['img-dims', url]
// 쿼리(퍼시스트)에 남겨 다음에 열 때 첫 렌더부터 정확한 높이로 그린다(설계서 §6.2).
function useImageAspectRatios(images: string[]) {
  const queryClient = useQueryClient();
  const seed = useCallback(
    () =>
      images.map((src) => {
        const d = queryClient.getQueryData<Dims>(["img-dims", src]);
        return d && d.width > 0 ? d.height / d.width : 0;
      }),
    [images, queryClient],
  );
  const [ratios, setRatios] = useState<number[]>(seed);
  // 문항이 바뀌면(이미지 배열 교체) 이전 문항의 비율을 버린다 — 렌더 중 상태 맞추기 패턴.
  const [measuredFor, setMeasuredFor] = useState(images);
  if (measuredFor !== images) {
    setMeasuredFor(images);
    setRatios(seed());
  }

  const handleLoad = useCallback(
    (index: number, e: ImageLoadEventData) => {
      const { width, height, url } = e.source;
      if (!width || !height) return;
      queryClient.setQueryData<Dims>(["img-dims", url || images[index]], { width, height });
      const ratio = height / width;
      setRatios((prev) => {
        if (prev[index] === ratio) return prev;
        const next = [...prev];
        next[index] = ratio;
        return next;
      });
    },
    [images, queryClient],
  );

  return { ratios, handleLoad };
}

export function SingleQuestionView({
  questionIndex,
  questions,
  images,
  prevIndex,
  nextIndex,
  onNavigate,
  tool,
  penColor,
  penWidth = DEFAULT_PEN_WIDTH,
  strokes,
  onStrokeEnd,
  onSubmit,
  submitting,
  submitted,
  error,
  zoom = 1,
  onPinchZoom,
  caption,
  emptyImagesText,
  submitSlot,
}: {
  questionIndex: number;
  // 세트문제는 화면 하나에 여러 문제가 같이 보이므로 답 선택 줄도 번호 수만큼(보통 1개).
  questions: QuestionAnswerState[];
  images: string[];
  prevIndex: number | null;
  nextIndex: number | null;
  onNavigate: (index: number) => void;
  tool: DrawTool;
  penColor: string;
  penWidth?: number;
  // 이 문항의 확정 획(부모가 문항별로 보관 — 넘겼다 돌아와도 그대로).
  strokes: InkStroke[];
  onStrokeEnd: (questionIndex: number, stroke: InkStroke) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitted: boolean;
  error?: string | null;
  zoom?: number;
  onPinchZoom?: (factor: number) => void;
  // 문제 상자 아래 한 줄 캡션(복습 솔버의 "출처와 정답은 채점 후에 공개돼요.").
  caption?: string;
  // 이미지가 아직 없을 때 문구(복습 솔버는 웹과 같은 "이 문제의 이미지가 없어요.").
  emptyImagesText?: string;
  // 하단 이동줄 아래에 둘 제출 영역(복습 솔버의 큰 제출 버튼·"지금 채점" 링크). 주면 마지막
  // 문항의 체크 아이콘 자리는 웹처럼 빈 칸(w-[38px])이 된다.
  submitSlot?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const firstNumber = questions[0]?.number ?? questionIndex + 1;
  const isLast = nextIndex === null;

  // ── 폭 계산(웹 useFitContentWidth) ──────────────────────────────────────────
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [contentHeight, setContentHeight] = useState(0);
  const { ratios, handleLoad } = useImageAspectRatios(images);
  const [stableBaseWidth, setStableBaseWidth] = useState(BASE_CONTENT_WIDTH);

  const totalAspect = ratios.reduce((sum, r) => sum + r, 0);
  const allMeasured = images.length > 0 && ratios.length === images.length && ratios.every((r) => r > 0);
  const usableHeight = area.height - AREA_PADDING * 2 - IMAGE_GAP * Math.max(0, images.length - 1) - 4;
  const measuredBaseWidth =
    allMeasured && usableHeight > 0 && totalAspect > 0
      ? Math.min(BASE_CONTENT_WIDTH, Math.max(MIN_FIT_WIDTH, usableHeight / totalAspect))
      : null;
  if (measuredBaseWidth !== null && measuredBaseWidth !== stableBaseWidth) {
    setStableBaseWidth(measuredBaseWidth);
  }
  const availableWidth = Math.max(0, area.width - AREA_PADDING * 2);
  // 웹 `w-full max-w-[contentWidth]`: 폰 폭보다 커지지 않는다.
  const contentWidth =
    availableWidth > 0
      ? Math.min(availableWidth, Math.round((measuredBaseWidth ?? stableBaseWidth) * zoom))
      : 0;
  // 웹 min-h-full: 이미지 아래 빈 공간까지 필기 캔버스로 덮는다.
  const minContentHeight = Math.max(0, area.height - AREA_PADDING * 2);
  const inkHeight = Math.max(contentHeight, minContentHeight);
  const placeholderHeight = Math.round(area.height * 0.6);

  // ── 제스처 상태는 Reanimated 공유값에 둔다 ─────────────────────────────────
  // (useRef 가 아니다: 제스처 빌더 콜백은 렌더 중에 만들어져 이벤트 시점에만 실행되지만,
  // react-hooks/refs 는 그 안의 ref 접근을 "렌더 중 접근"으로 본다. 공유값은 runOnJS(true)
  // 콜백에서 JS 스레드 값으로 읽고 쓰며, 아래 useAnimatedStyle 보다 먼저 정의해야 한다 —
  // 훅에 잡힌 뒤에는 immutability 규칙이 대입을 막는다.)
  const pinchScale = useSharedValue(1);
  const swipeStart = useSharedValue<{ x: number; y: number } | null>(null);
  const liveStroke = useSharedValue<InkStroke | null>(null);
  // 그리는 중인 획의 렌더용 사본(공유값 → React 상태).
  const [live, setLive] = useState<InkStroke | null>(null);

  // ── 핀치(라이브 미리보기는 공유값, 확정은 부모 zoom) ─────────────────────────
  const commitPinch = (factor: number) => {
    if (factor > 0 && Math.abs(factor - 1) > 0.01) onPinchZoom?.(factor);
  };
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      pinchScale.value = Math.min(MAX_ZOOM / zoom, Math.max(MIN_ZOOM / zoom, e.scale));
    })
    .onEnd(() => {
      const factor = pinchScale.value;
      pinchScale.value = 1;
      runOnJS(commitPinch)(factor);
    });

  // ── 스와이프(move 도구에서만; 활성화하지 않는 Manual 이라 세로 스크롤을 방해하지 않는다) ──
  const goPrev = () => {
    if (prevIndex !== null) onNavigate(prevIndex);
  };
  const goNext = () => {
    if (nextIndex !== null) onNavigate(nextIndex);
  };
  const swipe = Gesture.Manual()
    .enabled(tool === "move")
    .runOnJS(true)
    .onTouchesDown((e) => {
      if (e.numberOfTouches !== 1) {
        swipeStart.value = null;
        return;
      }
      const t = e.allTouches[0];
      swipeStart.value = { x: t.absoluteX, y: t.absoluteY };
    })
    .onTouchesMove((e) => {
      // 도중에 손가락이 더 닿으면(핀치 등) 스와이프로 취급하지 않는다.
      if (e.numberOfTouches > 1) swipeStart.value = null;
    })
    .onTouchesUp((e) => {
      const start = swipeStart.value;
      swipeStart.value = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.absoluteX - start.x;
      const dy = t.absoluteY - start.y;
      if (Math.abs(dx) < SWIPE_MIN_DX || Math.abs(dx) < Math.abs(dy) * SWIPE_DX_OVER_DY) return;
      if (dx < 0) goNext();
      else goPrev();
    })
    .onTouchesCancelled(() => {
      swipeStart.value = null;
    });

  // ── 필기(펜/지우개; 상자 위 Pan 이 포인터를 잡는다) ───────────────────────────
  const draw = Gesture.Pan()
    .enabled(tool !== "move")
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
      if (tool === "move" || contentWidth <= 0) return;
      const stroke: InkStroke = {
        erase: tool === "eraser",
        color: penColor,
        width: normalizedWidth(tool, penWidth, contentWidth),
        points: [toNormalizedPoint(e.x, e.y, contentWidth)],
      };
      liveStroke.value = stroke;
      setLive(stroke);
    })
    .onUpdate((e) => {
      const cur = liveStroke.value;
      if (!cur || contentWidth <= 0) return;
      const p = toNormalizedPoint(e.x, e.y, contentWidth);
      const last = cur.points[cur.points.length - 1];
      // 직전 점과 너무 가까우면 버려 획 배열·리렌더 비용을 줄인다.
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.002) return;
      const next: InkStroke = { ...cur, points: [...cur.points, p] };
      liveStroke.value = next;
      setLive(next);
    })
    .onFinalize(() => {
      const cur = liveStroke.value;
      liveStroke.value = null;
      setLive(null);
      // 점 하나짜리(움직이지 않은 탭)는 화면에도 아무것도 안 그려지므로 넘기지 않는다.
      if (cur && cur.points.length > 1) onStrokeEnd(questionIndex, cur);
    });

  const pinchStyle = useAnimatedStyle(() => ({ transform: [{ scale: pinchScale.value }] }));

  // ScrollView 는 RN 것을 쓴다 — Gesture.Native() 가 이 뷰의 네이티브 핸들러가 되어 핀치·스와이프와 동시 동작한다.
  const native = Gesture.Native();
  const areaGesture = Gesture.Simultaneous(native, pinch, swipe);

  const onAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setArea((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);
  const onContentLayout = useCallback((e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    setContentHeight((prev) => (prev === height ? prev : height));
  }, []);

  return (
    <View className="min-h-0 flex-1">
      <View className="min-h-0 flex-1 bg-zinc-100 dark:bg-zinc-800" onLayout={onAreaLayout}>
        <GestureDetector gesture={areaGesture}>
          <ScrollView
            className="flex-1"
            contentContainerStyle={{ padding: AREA_PADDING, minHeight: area.height }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {contentWidth > 0 && (
              <Animated.View style={[{ width: contentWidth, alignSelf: "center" }, pinchStyle]}>
                <GestureDetector gesture={draw}>
                  <View
                    onLayout={onContentLayout}
                    style={{ width: contentWidth, minHeight: minContentHeight }}
                    className="overflow-hidden rounded-lg border border-zinc-200 bg-white"
                  >
                    {images.length === 0 ? (
                      <AppText variant="sm" className="pt-24 text-center text-zinc-400 dark:text-zinc-600">
                        {emptyImagesText ?? "아직 이 문제의 이미지가 등록되지 않았어요."}
                      </AppText>
                    ) : (
                      images.map((src, i) => (
                        <Image
                          key={src}
                          source={{ uri: src }}
                          accessibilityLabel={`${firstNumber}번 문제 이미지 ${i + 1}`}
                          contentFit="contain"
                          cachePolicy="memory-disk"
                          priority="high"
                          transition={0}
                          style={{
                            width: contentWidth,
                            height: ratios[i] > 0 ? Math.round(contentWidth * ratios[i]) : placeholderHeight,
                            marginTop: i > 0 ? IMAGE_GAP : 0,
                          }}
                          onLoad={(e) => handleLoad(i, e)}
                        />
                      ))
                    )}
                    <InkLayer width={contentWidth} height={inkHeight} strokes={strokes} live={live} />
                  </View>
                </GestureDetector>
              </Animated.View>
            )}
            {caption && (
              <AppText
                variant="xs"
                className="mt-3 w-full max-w-2xl self-center text-center text-zinc-400 dark:text-zinc-600"
                pretty
              >
                {caption}
              </AppText>
            )}
          </ScrollView>
        </GestureDetector>
      </View>

      <View
        className="shrink-0 border-t border-zinc-200 bg-white px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900"
        style={{ paddingBottom: 12 + insets.bottom }}
      >
        {error && (
          <AppText variant="xs" className="mb-2 text-center text-red-600 dark:text-red-400" pretty>
            {error}
          </AppText>
        )}
        <View className="w-full max-w-2xl flex-row items-center gap-2 self-center">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="이전 문제"
            accessibilityState={{ disabled: prevIndex === null }}
            disabled={prevIndex === null}
            onPress={goPrev}
            className={[
              "shrink-0 items-center justify-center rounded-full p-2 active:bg-zinc-100 dark:active:bg-zinc-800",
              prevIndex === null ? "opacity-30" : "",
            ].join(" ")}
          >
            <PrevIcon size={22} colorClassName="text-zinc-600 dark:text-zinc-400" />
          </Pressable>

          {/* 세트문제는 번호마다 줄을 따로 두고 줄 앞에 번호 배지(줄이 하나뿐이면 배지 없음). */}
          <View className="flex-1 gap-2">
            {questions.map((q) => (
              <View key={q.number} className="flex-row items-center justify-center gap-2">
                {questions.length > 1 && (
                  <View className="h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 dark:bg-zinc-700">
                    <AppText variant="xs" weight="bold" className="text-white" allowFontScaling={false}>
                      {q.number}
                    </AppText>
                  </View>
                )}
                <View className="flex-row justify-center gap-2">
                  {Array.from({ length: q.choiceCount }, (_, c) => c + 1).map((choice) => {
                    const isSelected = q.selected === choice;
                    const isCorrectChoice = submitted && !!q.questionResult?.is_correct && isSelected;
                    const isWrongChoice = submitted && !!q.questionResult && !q.questionResult.is_correct && isSelected;
                    const box = isCorrectChoice
                      ? "bg-emerald-500"
                      : isWrongChoice
                        ? "bg-red-500"
                        : isSelected
                          ? "bg-blue-600"
                          : "bg-zinc-100 active:bg-zinc-200 dark:bg-zinc-800 dark:active:bg-zinc-700";
                    const text = isSelected ? "text-white" : "text-zinc-600 dark:text-zinc-400";
                    return (
                      <Pressable
                        key={choice}
                        accessibilityRole="button"
                        accessibilityLabel={`${q.number}번 ${choice}번 선택지`}
                        accessibilityState={{ selected: isSelected, disabled: submitted }}
                        disabled={submitted}
                        onPress={() => q.onSelect(choice)}
                        className={["h-10 w-10 items-center justify-center rounded-full", box].join(" ")}
                      >
                        <AppText variant="sm" weight="semibold" className={text} allowFontScaling={false}>
                          {choice}
                        </AppText>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>

          {/* 마지막 문제에서는 "다음" 대신 제출 버튼. 채점이 끝난 뒤에는 비활성 다음 버튼. */}
          {isLast && !submitted && submitSlot ? (
            // 복습 솔버: 제출은 아래 submitSlot 이 맡고 여기는 웹처럼 자리만 비운다.
            <View className="w-[38px] shrink-0" />
          ) : isLast && !submitted ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="제출하고 채점"
              accessibilityState={{ disabled: submitting, busy: submitting }}
              disabled={submitting}
              onPress={onSubmit}
              className={[
                "shrink-0 items-center justify-center rounded-full p-2",
                submitting ? "bg-zinc-300 dark:bg-zinc-700" : "bg-blue-600 active:bg-blue-700",
              ].join(" ")}
            >
              <CheckIcon size={22} colorClassName="text-white" />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="다음 문제"
              accessibilityState={{ disabled: nextIndex === null }}
              disabled={nextIndex === null}
              onPress={goNext}
              className={[
                "shrink-0 items-center justify-center rounded-full p-2 active:bg-zinc-100 dark:active:bg-zinc-800",
                nextIndex === null ? "opacity-30" : "",
              ].join(" ")}
            >
              <NextIcon size={22} colorClassName="text-zinc-600 dark:text-zinc-400" />
            </Pressable>
          )}
        </View>
        {submitSlot}
      </View>
    </View>
  );
}
