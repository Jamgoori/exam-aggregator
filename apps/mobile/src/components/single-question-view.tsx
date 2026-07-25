import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { CbtQuestionResult } from "../lib/cbt";
import { MemoField } from "./memo-field";
import { useColors } from "../theme/colors";

// 문제별 보기 한 화면: 위쪽 문제 이미지(핀치줌), 아래쪽 문항별 선택지 + 이전/다음.
// 세트문제(공통지문)는 여러 번호가 같은 이미지를 공유하므로 numbers 로 함께 받는다.
export type SingleQuestion = {
  number: number;
  choiceCount: number;
  selected: number | null;
  onSelect: (choice: number) => void;
  result: CbtQuestionResult | null;
};

export function SingleQuestionView({
  images,
  questions,
  totalQuestions,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  paperId,
  showMemo,
}: {
  images: string[];
  questions: SingleQuestion[];
  totalQuestions: number;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  // 메모는 로그인 사용자에게만 표시(CBT 풀이 중 문항별 메모).
  paperId?: string;
  showMemo?: boolean;
}) {
  const colors = useColors();
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(4, Math.max(1, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
    });
  const imgStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const first = questions[0]?.number;
  const last = questions[questions.length - 1]?.number;
  const label = first === last ? `${first}번` : `${first}~${last}번`;

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Text style={{ fontWeight: "700" }}>
          {label}
          <Text style={{ color: colors.textMuted, fontWeight: "400" }}>
            {" "}
            / {totalQuestions}
          </Text>
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* 문제 이미지 — 핀치줌. 세트문제면 여러 장을 세로로 쌓는다. */}
        <GestureDetector gesture={pinch}>
          <Animated.View style={[{ padding: 8 }, imgStyle]}>
            {images.map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={{ width: "100%", aspectRatio: 0.72 }}
                contentFit="contain"
                transition={100}
              />
            ))}
          </Animated.View>
        </GestureDetector>

        {/* 문항별 선택지 */}
        {questions.map((q) => (
          <View key={q.number} style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={{ fontWeight: "600", marginBottom: 6 }}>{q.number}번</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {Array.from({ length: q.choiceCount }, (_, c) => {
                const choice = c + 1;
                const isSelected = q.selected === choice;
                let bg = colors.bg;
                let border = colors.border;
                let fg = colors.text;
                if (isSelected) {
                  if (q.result) {
                    bg = q.result.is_correct ? colors.success : colors.danger;
                    border = bg;
                  } else {
                    bg = colors.primary;
                    border = colors.primary;
                  }
                  fg = colors.primaryText;
                }
                return (
                  <Pressable
                    key={choice}
                    disabled={!!q.result}
                    onPress={() => q.onSelect(choice)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      borderWidth: 1,
                      borderColor: border,
                      backgroundColor: bg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: fg, fontSize: 16 }}>{choice}</Text>
                  </Pressable>
                );
              })}
            </View>
            {showMemo && paperId && (
              <MemoField paperId={paperId} questionNumber={q.number} />
            )}
          </View>
        ))}
      </ScrollView>

      {/* 이전/다음 */}
      <View
        style={{
          flexDirection: "row",
          gap: 10,
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <NavButton label="이전" onPress={onPrev} disabled={!hasPrev} />
        <NavButton label="다음" onPress={onNext} disabled={!hasNext} />
      </View>
    </View>
  );
}

function NavButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
}
