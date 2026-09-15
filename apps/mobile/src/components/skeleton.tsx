import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { View, type ViewProps } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { palette } from "../theme";

// 웹 .skeleton(설계서 §4.5 #8): 바탕 #e4e4e7 / 다크 #27272a, 1.8s 스윕. 하이라이트는 토큰이
// 아니라 리터럴(진짜 파랑 blue-100 + 흰색) — 재정의된 blue-100 으로 그리면 색이 달라진다.
// `delay` 는 웹 --skeleton-delay 캐스케이드.
export function Skeleton({ className, delay = 0, style, ...rest }: ViewProps & { className?: string; delay?: number }) {
  const [width, setWidth] = useState(0);
  const x = useSharedValue(-1);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) return;
    x.value = -1;
    x.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }), -1, false),
    );
  }, [delay, reduce, x]);

  const sweep = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * width }] }));

  return (
    <View
      {...rest}
      style={style}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      className={["overflow-hidden rounded bg-[#e4e4e7] dark:bg-[#27272a]", className ?? ""].join(" ")}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {!reduce && width > 0 && (
        <Animated.View style={[{ position: "absolute", top: 0, bottom: 0, left: 0, width }, sweep]}>
          <LinearGradient
            colors={palette.skeletonSweep}
            locations={[0.3, 0.48, 0.52, 0.56, 0.7]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      )}
    </View>
  );
}
