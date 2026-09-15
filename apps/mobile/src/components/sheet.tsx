import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Dimensions, Modal, Pressable, View, KeyboardAvoidingView, Platform } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./app-text";
import { themedIcon } from "../theme/icons";

// 바텀시트(설계서 §4.5 #7). 웹 모달 규격을 시트로: 오버레이 modal-fade-in 180ms, 패널
// modal-panel-in 240ms bezier(0.16,1,0.3,1) translateY 12→0 · scale .98→1. 높이는 시트별
// (기본 max-h 88%, 채팅 고정 85%, OMR max 65%, 초성·알림 70%) — 단일 규격으로 통일하지 않는다.
// 드래그로 닫기(GH Pan), 키보드 회피.
const PANEL_EASING = Easing.bezier(0.16, 1, 0.3, 1);
const DISMISS_DISTANCE = 80;

const CloseIcon = themedIcon(X);

export type SheetProps = {
  visible: boolean;
  onClose: () => void;
  // "85%" 처럼 고정 높이, 없으면 내용 높이(maxHeight 까지).
  height?: `${number}%` | number;
  maxHeight?: `${number}%` | number;
  rounded?: "3xl" | "2xl";
  title?: string;
  // 헤더 아이콘 타일(h-9 w-9 rounded-xl from-blue-500 to-blue-600) 안에 들어갈 요소.
  icon?: React.ReactNode;
  overlayClassName?: string;
  children?: React.ReactNode;
};

export function Sheet({
  visible,
  onClose,
  height,
  maxHeight = "88%",
  rounded = "3xl",
  title,
  icon,
  overlayClassName = "bg-black/40",
  children,
}: SheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const overlay = useSharedValue(0);
  const translateY = useSharedValue(12);
  const scale = useSharedValue(0.98);
  const drag = useSharedValue(0);
  const screenH = Dimensions.get("window").height;

  // visible 이 켜지면 같은 렌더에서 마운트(React 의 "prop 변화에 상태 맞추기" 패턴 —
  // 효과 안 setState 대신). 닫힘은 퇴장 애니메이션이 끝난 뒤 콜백에서 언마운트.
  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      overlay.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.ease) });
      translateY.value = withTiming(0, { duration: 240, easing: PANEL_EASING });
      scale.value = withTiming(1, { duration: 240, easing: PANEL_EASING });
    } else if (mounted) {
      overlay.value = withTiming(0, { duration: 160 });
      translateY.value = withTiming(screenH, { duration: 200, easing: Easing.in(Easing.ease) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 드래그 오프셋은 효과에서 건드리지 않는다(제스처 콜백 안에서만 쓰고 되돌린다).
  const pan = Gesture.Pan()
    .onStart(() => {
      drag.value = 0;
    })
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (drag.value > DISMISS_DISTANCE || e.velocityY > 800) {
        drag.value = 0;
        runOnJS(onClose)();
      } else {
        drag.value = withTiming(0, { duration: 160 });
      }
    });

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value + drag.value }, { scale: scale.value }],
  }));

  if (!mounted) return null;

  const toPx = (v: `${number}%` | number | undefined) =>
    v == null ? undefined : typeof v === "number" ? v : (screenH * parseFloat(v)) / 100;

  return (
    <Modal visible transparent statusBarTranslucent onRequestClose={onClose} animationType="none">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} className="flex-1 justify-end">
        <Animated.View style={overlayStyle} className={["absolute inset-0", overlayClassName].join(" ")}>
          <Pressable accessibilityLabel="닫기" accessibilityRole="button" onPress={onClose} className="flex-1" />
        </Animated.View>
        <GestureDetector gesture={pan}>
          <Animated.View
            style={[
              panelStyle,
              { height: toPx(height), maxHeight: toPx(maxHeight), paddingBottom: insets.bottom },
            ]}
            className={[
              "w-full bg-white shadow-2xl dark:bg-zinc-900",
              rounded === "3xl" ? "rounded-t-3xl" : "rounded-t-2xl",
            ].join(" ")}
          >
            <View className="items-center pt-2.5 pb-1">
              <View className="h-1 w-9 rounded-full bg-zinc-200 dark:bg-zinc-700" />
            </View>
            {(title || icon) && (
              <View className="flex-row items-center gap-3 border-b border-zinc-100 px-5 py-3 dark:border-zinc-800">
                {icon && (
                  <View className="h-9 w-9 items-center justify-center rounded-xl bg-blue-600">{icon}</View>
                )}
                <AppText variant="base" weight="bold" className="min-w-0 flex-1" numberOfLines={1}>
                  {title}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="닫기"
                  onPress={onClose}
                  className="-mr-1 h-9 w-9 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
                >
                  <CloseIcon size={18} colorClassName="text-zinc-400" />
                </Pressable>
              </View>
            )}
            <View className="min-h-0 shrink">{children}</View>
          </Animated.View>
        </GestureDetector>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// 가운데 모달(`max-w-sm rounded-2xl p-8`; 초성용은 size="md" → `max-w-md rounded-xl p-5`).
export function CenterModal({
  visible,
  onClose,
  size = "sm",
  children,
}: {
  visible: boolean;
  onClose: () => void;
  size?: "sm" | "md";
  children?: React.ReactNode;
}) {
  if (!visible) return null;
  return (
    <Modal visible transparent statusBarTranslucent onRequestClose={onClose} animationType="fade">
      <View className="flex-1 items-center justify-center bg-black/40 px-4">
        <Pressable accessibilityLabel="닫기" onPress={onClose} className="absolute inset-0" />
        <View
          className={[
            "w-full bg-white shadow-xl dark:bg-zinc-900",
            size === "sm" ? "max-w-sm rounded-2xl p-8" : "max-h-[70%] max-w-md rounded-xl p-5",
          ].join(" ")}
        >
          {children}
        </View>
      </View>
    </Modal>
  );
}
