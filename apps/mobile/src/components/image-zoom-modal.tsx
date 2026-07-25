import { Image } from "expo-image";
import { Modal, Pressable, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

// 문항 이미지 확대. 오답노트의 과목 화면·문제지 화면이 함께 쓴다.
export function ImageZoomModal({
  uri,
  onClose,
}: {
  uri: string | null;
  onClose: () => void;
}) {
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
    <Modal visible={!!uri} transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)" }}>
        <Pressable
          onPress={onClose}
          style={{ position: "absolute", top: 48, right: 20, zIndex: 2 }}
        >
          <Text style={{ color: "#fff", fontSize: 16 }}>닫기</Text>
        </Pressable>
        {uri && (
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
        )}
      </View>
    </Modal>
  );
}
