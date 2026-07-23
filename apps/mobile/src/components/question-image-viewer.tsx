import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

// 문제별 크롭 이미지 뷰어 + 핀치줌.
// 웹 useExamZoom(DOM wheel/touch 이벤트)을 RN 제스처로 재구현한 최소 골격.
// 크롭 이미지 경로는 papers.ts getQuestionImages() → storage.publicUrl() 로 만든다.
export function QuestionImageViewer({ uri }: { uri: string }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(4, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={pinch}>
      <Animated.View style={[{ flex: 1 }, style]}>
        <Image
          source={{ uri }}
          style={{ flex: 1 }}
          contentFit="contain"
          transition={100}
        />
      </Animated.View>
    </GestureDetector>
  );
}
