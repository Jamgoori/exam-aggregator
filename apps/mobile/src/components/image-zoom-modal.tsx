import { Image } from "expo-image";
import { Modal, Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./app-text";

// 문항 이미지 확대. 오답노트의 과목 화면·문제지 화면이 함께 쓴다.
export function ImageZoomModal({
  uri,
  onClose,
  label,
}: {
  uri: string | null;
  onClose: () => void;
  // 웹 alt 문구(예: "3번 문제 이미지 1").
  label?: string;
}) {
  const insets = useSafeAreaInsets();
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(5, Math.max(1, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
    });
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Modal visible={!!uri} transparent statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1 bg-black/90">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          style={{ top: insets.top + 12 }}
          className="absolute right-5 z-10 rounded-full bg-white/10 px-3 py-1.5"
        >
          <AppText variant="base" className="text-white">
            닫기
          </AppText>
        </Pressable>
        {uri && (
          <GestureDetector gesture={pinch}>
            <Animated.View style={[{ flex: 1 }, style]}>
              <Image
                source={{ uri }}
                style={{ flex: 1 }}
                contentFit="contain"
                transition={100}
                cachePolicy="memory-disk"
                accessibilityLabel={label}
              />
            </Animated.View>
          </GestureDetector>
        )}
      </View>
    </Modal>
  );
}
