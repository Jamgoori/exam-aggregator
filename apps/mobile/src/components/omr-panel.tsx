import { FlatList, Pressable, Text, View } from "react-native";
import type { CbtQuestionResult } from "../lib/cbt";
import { useColors } from "../theme/colors";

// 웹 cbt-omr-panel 의 앱판. 문항번호별 선택지 버블. 채점 후엔 정/오답 색으로 표시.
export function OmrPanel({
  totalQuestions,
  choiceCount,
  answers,
  onSelect,
  resultByQuestion,
}: {
  totalQuestions: number;
  choiceCount: number;
  answers: (number | null)[];
  onSelect: (questionIndex: number, choice: number) => void;
  resultByQuestion: Map<number, CbtQuestionResult> | null;
}) {
  const colors = useColors();
  const rows = Array.from({ length: totalQuestions }, (_, i) => i);

  return (
    <FlatList
      data={rows}
      keyExtractor={(i) => String(i)}
      contentContainerStyle={{ padding: 12, gap: 6 }}
      renderItem={({ item: idx }) => {
        const selected = answers[idx];
        const res = resultByQuestion?.get(idx + 1) ?? null;
        return (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              style={{
                width: 28,
                textAlign: "right",
                fontSize: 13,
                color: colors.textMuted,
              }}
            >
              {idx + 1}
            </Text>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {Array.from({ length: choiceCount }, (_, c) => {
                const choice = c + 1;
                const isSelected = selected === choice;
                // 채점 후: 정답 문항의 선택은 초록, 오답 선택은 빨강.
                let bg = colors.bg;
                let border = colors.border;
                let fg = colors.text;
                if (isSelected) {
                  if (res) {
                    bg = res.is_correct ? colors.success : colors.danger;
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
                    disabled={!!resultByQuestion}
                    onPress={() => onSelect(idx, choice)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      borderWidth: 1,
                      borderColor: border,
                      backgroundColor: bg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: fg, fontSize: 13 }}>{choice}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        );
      }}
    />
  );
}
