import { ChevronLeft, ChevronRight, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { attendancePromoSource } from "./attendance-promo-slide";
import { betaNoticeSource } from "./beta-notice-slide";
import { freePromoSource } from "./free-promo-slide";
import type { HomePopupContext, HomePopupControls, HomePopupSlide, HomePopupSource } from "./home-popup";
import { reviewNudgeSource } from "./review-nudge-slide";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 홈 팝업 슬라이드 판(설계서 §4.5 #30) — 웹 apps/web/src/components/home-popup-slider.tsx 이식.
// 규칙과 배경은 home-popup.ts 머리말 참고.
//
// 앞에 둔 것이 앞 장이 된다. 복습 유도를 맨 앞에 두는 건 그 장이 유일하게 "오늘 할 일"이기
// 때문이다 — 그 장이 뜬 사람은 이미 로그인해서 문제를 풀어본 사람이라, 처음 온 사람에게
// 필요한 개발 중 안내보다 이쪽이 먼저 닿아야 한다. 전면 무료는 비회원에게만, 복습 유도는
// 회원에게만 뜨므로 둘이 한 판에 같이 실릴 일은 없다.
const SOURCES: HomePopupSource[] = [
  reviewNudgeSource,
  freePromoSource,
  betaNoticeSource,
  attendancePromoSource,
];

// 한 박자 늦게 띄운다. 화면이 그려지는 순간 같이 덮으면 사용자가 뭘 열었는지도 모르는 채로
// 닫기부터 누른다 — 도착한 화면을 먼저 보게 두는 것.
const OPEN_DELAY_MS = 500;

// 손가락이 이만큼(판 너비의 18%, 최소 40px) 움직여야 장을 넘긴다. 너무 짧으면 세로로
// 스크롤하려던 손짓에도 장이 넘어간다.
const SWIPE_RATIO = 0.18;
const SWIPE_MIN_PX = 40;
// 양 끝에서는 덜 끌려간다 — 더 넘길 게 없다는 걸 손으로 알려주는 것.
const EDGE_RESISTANCE = 0.3;

// 판의 기본 폭(웹 max-w-sm 24rem / 넓은 판 max-w-md 28rem)과, 비율이 고정된 장이 실렸을 때
// 판이 지켜야 하는 상한. 6.5rem(104) 은 버튼 띠와 점(dot) 띠가 가져가는 높이.
const PANEL_WIDTH = 384;
const PANEL_WIDTH_WIDE = 448;
const PANEL_CHROME_PX = 104;
const PANEL_MAX_HEIGHT_RATIO = 0.92;

// 모션 토큰(§4.3, sheet.tsx 와 같은 값): 오버레이 180ms 페이드, 패널 240ms bezier.
const PANEL_EASING = Easing.bezier(0.16, 1, 0.3, 1);
const SLIDE_DURATION = 300;

const CloseIcon = themedIcon(X);
const PrevIcon = themedIcon(ChevronLeft);
const NextIcon = themedIcon(ChevronRight);

export function HomePopupSlider({ attendanceHref, signedIn }: HomePopupContext) {
  const [slides, setSlides] = useState<HomePopupSlide[]>([]);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  // 사용자가 한 번 닫았으면 늦게 도착한 장이 판을 다시 열어선 안 된다.
  const closed = useRef(false);
  // 판이 떠서 사용자가 무언가를 보고 있는 상태인지. 뜨기 전에는 어떤 장이 먼저 도착했든
  // 첫 장(우선순위가 제일 높은 장)에서 시작해야 한다.
  const opened = useRef(false);
  // 목록의 거울. 늦게 도착한 장을 어디에 끼울지를 setSlides 바깥에서 계산한다.
  const known = useRef<HomePopupSlide[]>([]);

  useEffect(() => {
    let alive = true;
    const ctx = { attendanceHref, signedIn };

    // 후보들에게 동시에 물어본다. kv 만 보는 쪽은 곧바로 답하고, 서버를 보는 쪽(복습 유도)만
    // 늦게 온다 — 그 하나 때문에 나머지를 붙잡아 두지 않는다.
    SOURCES.forEach((source, priority) => {
      Promise.resolve()
        .then(() => source.resolve(ctx))
        .then((slide) => {
          if (!alive || !slide || closed.current) return;
          const prev = known.current;
          if (prev.some((s) => s.id === slide.id)) return;
          // 우선순위 자리에 끼워 넣는다.
          const found = prev.findIndex((s) => priorityOf(s) > priority);
          const at = found < 0 ? prev.length : found;
          const next = [...prev];
          next.splice(at, 0, slide);
          known.current = next;
          setSlides(next);
          // 이미 판이 떠 있는데 앞자리에 끼어들었다면 index 를 한 칸 밀어 보고 있던 장을
          // 그대로 둔다 — 눈앞의 안내가 소리 없이 바뀌면 방금 읽던 문장을 잃는다.
          setIndex((i) => (!opened.current ? 0 : at <= i ? i + 1 : i));
        })
        .catch(() => {
          // 조회 실패는 조용히 넘긴다. 안내 팝업이 에러를 띄울 자리는 아니다.
        });
    });

    const id = setTimeout(() => {
      if (!alive || closed.current) return;
      opened.current = true;
      setOpen(true);
    }, OPEN_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [attendanceHref, signedIn]);

  const close = useCallback(() => {
    closed.current = true;
    setOpen(false);
  }, []);

  // 이 장만 걷어낸다. 남은 장이 없으면 판이 닫힌다.
  const dismiss = useCallback((id: string) => {
    const next = known.current.filter((s) => s.id !== id);
    known.current = next;
    setSlides(next);
    if (next.length === 0) {
      closed.current = true;
      setOpen(false);
      return;
    }
    // 마지막 장을 치웠으면 한 칸 앞으로 당겨야 빈자리를 보여주지 않는다.
    setIndex((i) => Math.min(i, next.length - 1));
  }, []);

  if (!open || slides.length === 0) return null;

  return (
    <HomePopupPanel
      slides={slides}
      index={Math.min(index, slides.length - 1)}
      onIndexChange={setIndex}
      onClose={close}
      onDismiss={dismiss}
    />
  );
}

function priorityOf(slide: HomePopupSlide): number {
  const at = SOURCES.findIndex((s) => s.id === slide.id);
  return at < 0 ? SOURCES.length : at;
}

// 판 자체. open 이 된 뒤에만 마운트된다.
function HomePopupPanel({
  slides,
  index,
  onIndexChange,
  onClose,
  onDismiss,
}: {
  slides: HomePopupSlide[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onDismiss: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const active = slides[index];
  const many = slides.length > 1;
  // 한 장이라도 넓은 판을 요구하면 넓힌다 — 넘길 때마다 판 폭이 바뀌면 내용이 아니라 창이
  // 움직이는 것처럼 보인다.
  const wide = slides.some((s) => s.wide);
  // 비율을 요구하는 장이 여럿이면 제일 좁은(세로로 긴) 쪽에 맞춘다 — 하나라도 잘리면 안 된다.
  const aspect = slides.reduce<number | null>(
    (min, s) => (s.aspect == null ? min : min == null ? s.aspect : Math.min(min, s.aspect)),
    null,
  );

  const panelMaxHeight = windowHeight * PANEL_MAX_HEIGHT_RATIO;
  const base = wide ? PANEL_WIDTH_WIDE : PANEL_WIDTH;
  // 비율이 고정된 장이 실려 있으면 판의 폭을 화면 높이에 묶는다. 세로가 짧은 기기에서 폭을
  // 그대로 두면 그림이 판 밖으로 넘쳐 잘린다.
  const maxWidth = aspect ? Math.min(base, (panelMaxHeight - PANEL_CHROME_PX) * aspect) : base;
  const panelWidth = Math.min(windowWidth, maxWidth);

  // ── 애니메이션 값 ──────────────────────────────────────────────────────────
  const overlay = useSharedValue(0);
  const enterY = useSharedValue(12);
  const enterScale = useSharedValue(0.98);
  const drag = useSharedValue(0);
  const trackHeight = useSharedValue(0);
  // 지금 보고 있는 장의 위치. index(상태)를 따라 300ms 로 미끄러진다 — 웹의
  // `transition-transform duration-300` 자리다. 손가락이 끄는 거리(drag)는 이 값에 더해진다.
  const position = useDerivedValue(() =>
    withTiming(index, { duration: SLIDE_DURATION, easing: Easing.out(Easing.ease) }),
  );

  useEffect(() => {
    overlay.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.ease) });
    enterY.value = withTiming(0, { duration: 240, easing: PANEL_EASING });
    enterScale.value = withTiming(1, { duration: 240, easing: PANEL_EASING });
    // 공유 값은 안정된 참조라 deps 에 넣지 않는다(sheet.tsx 와 같은 처리 — 넣으면 제스처
    // 콜백에서 같은 값을 쓰지 못한다는 react-hooks/immutability 에 걸린다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useCallback(
    (to: number) => onIndexChange(Math.max(0, Math.min(to, slides.length - 1))),
    [onIndexChange, slides.length],
  );

  // 이 장이 실제로 보인 순간 한 번 "봤다"를 기록한다. 실려만 있고 넘겨 보지 않은 장은
  // 기록하지 않아, 다음에 다시 기회를 얻는다(home-popup.ts).
  const shown = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!active || shown.current.has(active.id)) return;
    shown.current.add(active.id);
    active.onShown?.();
  }, [active]);

  // 장마다 내용 높이가 크게 다르다(짧은 복습 유도 ↔ 세로로 긴 광고). 판 높이를 제일 큰 장에
  // 맞춰 고정하면 짧은 장이 텅 빈 채로 보이므로, 보고 있는 장의 높이만큼만 차지하게 하고
  // 넘어갈 때 높이도 함께 움직인다. 본문은 ScrollView 의 contentSize(눌리지 않은 원래 높이),
  // 버튼 띠는 onLayout 으로 잰다.
  const [bodyHeights, setBodyHeights] = useState<Record<string, number>>({});
  const [footerHeights, setFooterHeights] = useState<Record<string, number>>({});
  const measured = active
    ? (bodyHeights[active.id] ?? 0) + (footerHeights[active.id] ?? 0)
    : 0;

  useEffect(() => {
    if (measured <= 0) return;
    // 처음 잰 값은 곧바로(애니메이션 없이) — 판이 열리자마자 높이가 늘어나 보이면 안 된다.
    if (trackHeight.value === 0) trackHeight.value = measured;
    else trackHeight.value = withTiming(measured, { duration: SLIDE_DURATION, easing: Easing.out(Easing.ease) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured]);

  const setBodyHeight = useCallback((id: string, h: number) => {
    setBodyHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));
  }, []);
  const setFooterHeight = useCallback((id: string, h: number) => {
    setFooterHeights((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));
  }, []);

  // ── 스와이프 ──────────────────────────────────────────────────────────────
  const count = slides.length;
  // 제스처 객체는 렌더마다 새로 만든다(sheet.tsx 와 같은 패턴). useMemo 로 감싸면 공유 값이
  // "훅에 넘긴 값"이 되어 콜백 안에서 못 고친다(react-hooks/immutability).
  //
  // 처음 몇 px 로 세로인지 가로인지 정하고, 세로면 손을 뗀다 — 본문을 스크롤하려던 손짓까지
  // 가로채면 긴 장을 읽을 수 없다(웹의 axis 판정과 같은 8px).
  const pan = Gesture.Pan()
    .enabled(count > 1)
    .activeOffsetX([-8, 8])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      // 양 끝에서는 덜 끌려간다 — 더 넘길 게 없다는 걸 손으로 알려주는 것.
      const atEdge =
        (e.translationX > 0 && index === 0) || (e.translationX < 0 && index === count - 1);
      drag.value = atEdge ? e.translationX * EDGE_RESISTANCE : e.translationX;
    })
    .onEnd(() => {
      const width = panelWidth || 1;
      const threshold = Math.max(SWIPE_MIN_PX, width * SWIPE_RATIO);
      const to = drag.value <= -threshold ? index + 1 : drag.value >= threshold ? index - 1 : index;
      const next = Math.max(0, Math.min(to, count - 1));
      // drag 는 0 으로, position 은 next 로 — 둘이 같은 길이·같은 easing 으로 달려 합이
      // 지금 보이는 자리에서 다음 장까지 한 번에 이어진다(중간에 튀지 않는다).
      drag.value = withTiming(0, { duration: SLIDE_DURATION, easing: Easing.out(Easing.ease) });
      if (next !== index) runOnJS(onIndexChange)(next);
    });

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: enterY.value }, { scale: enterScale.value }],
  }));
  const trackStyle = useAnimatedStyle(() => ({
    height: trackHeight.value === 0 ? undefined : trackHeight.value,
  }));
  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -position.value * panelWidth + drag.value }],
  }));

  const darkChip = active?.aspect != null || active?.darkHeader;

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      {/* Android 의 RN Modal 은 별도 네이티브 창이라 루트 GestureHandlerRootView 밖 — 안에
          하나 더 두지 않으면 RNGH 제스처가 터치를 받지 못한다(sheet.tsx 와 같은 이유). */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-end">
          {/* z-60 오버레이(웹 z-[60] bg-zinc-900/50 dark:bg-black/70). 판 밖을 누르면 닫힌다. */}
          <Animated.View style={overlayStyle} className="absolute inset-0 bg-zinc-900/50 dark:bg-black/70">
            <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={onClose} className="flex-1" />
          </Animated.View>

          <Animated.View
            accessibilityViewIsModal
            accessibilityLabel={active?.title ?? "안내"}
            style={[panelStyle, { width: panelWidth, maxHeight: panelMaxHeight, paddingBottom: insets.bottom }]}
            className="overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-zinc-900"
          >
            {/* 닫기(X)는 판에 하나만 둔다. 장마다 다른 자리에 있으면 넘길 때마다 X 가 옮겨
                다녀서 닫으려던 사람이 매번 눈으로 다시 찾아야 한다. 그림·짙은 머리 장 위에서는
                어떤 색 위에 얹힐지 모르므로 반투명 칩으로 띄운다. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="닫기"
              onPress={onClose}
              hitSlop={6}
              className={[
                "absolute top-3 right-3 z-10 h-9 w-9 items-center justify-center rounded-full",
                darkChip ? "bg-zinc-900/25" : "active:bg-zinc-100 dark:active:bg-zinc-800",
              ].join(" ")}
            >
              <CloseIcon size={18} colorClassName={darkChip ? "text-white" : "text-zinc-400 dark:text-zinc-500"} />
            </Pressable>

            <GestureDetector gesture={pan}>
              <Animated.View style={trackStyle} className="min-h-0 shrink overflow-hidden">
                <Animated.View style={[rowStyle, { flexDirection: "row", height: "100%" }]}>
                  {slides.map((slide, i) => {
                    const controls: HomePopupControls = {
                      close: onClose,
                      dismiss: () => onDismiss(slide.id),
                    };
                    const hidden = i !== index;
                    return (
                      // 보이지 않는 장의 버튼에 화면낭독기가 들어가면 사용자는 자기가 어디에
                      // 있는지 모르는 채로 다른 장의 버튼을 누른다(웹 inert 대응).
                      <View
                        key={slide.id}
                        style={{ width: panelWidth }}
                        pointerEvents={hidden ? "none" : "auto"}
                        accessibilityElementsHidden={hidden}
                        importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
                        className="shrink-0 flex-col"
                      >
                        <ScrollView
                          className="min-h-0 shrink"
                          showsVerticalScrollIndicator={false}
                          onContentSizeChange={(_w, h) => setBodyHeight(slide.id, h)}
                        >
                          {slide.body(controls)}
                        </ScrollView>
                        {slide.footer && (
                          <View
                            className="shrink-0"
                            onLayout={(e) => setFooterHeight(slide.id, e.nativeEvent.layout.height)}
                          >
                            {slide.footer(controls)}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </Animated.View>
              </Animated.View>
            </GestureDetector>

            {/* 장이 하나뿐이면 넘길 것이 없으므로 띠 자체를 두지 않는다 — 예전 팝업과 똑같이
                보인다. 화살표를 내용 위에 얹지 않고 이 띠에 넣는 이유는, 얹으면 좁은 화면에서
                글자나 광고를 가리기 때문이다. */}
            {many && (
              <View className="shrink-0 flex-row items-center justify-center gap-1.5 border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
                <ArrowButton direction="prev" disabled={index === 0} onPress={() => go(index - 1)} />
                <View className="flex-row items-center">
                  {slides.map((slide, i) => (
                    <Pressable
                      key={slide.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${slide.title} 보기`}
                      accessibilityState={{ selected: i === index }}
                      onPress={() => go(i)}
                      className="h-7 w-5 items-center justify-center"
                    >
                      <View
                        className={
                          i === index
                            ? "h-1.5 w-4 rounded-full bg-zinc-700 dark:bg-zinc-200"
                            : "h-1.5 w-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600"
                        }
                      />
                    </Pressable>
                  ))}
                </View>
                <ArrowButton direction="next" disabled={index === slides.length - 1} onPress={() => go(index + 1)} />
                <AppText
                  variant="11"
                  tabular
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                  className="absolute right-3 text-zinc-400 dark:text-zinc-600"
                >
                  {index + 1}/{slides.length}
                </AppText>
              </View>
            )}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function ArrowButton({
  direction,
  disabled,
  onPress,
}: {
  direction: "prev" | "next";
  disabled: boolean;
  onPress: () => void;
}) {
  const Icon = direction === "prev" ? PrevIcon : NextIcon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={direction === "prev" ? "이전 안내" : "다음 안내"}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      className={[
        "h-7 w-7 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800",
        disabled ? "opacity-25" : "",
      ].join(" ")}
    >
      <Icon size={16} colorClassName="text-zinc-400 dark:text-zinc-500" />
    </Pressable>
  );
}
