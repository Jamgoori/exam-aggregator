import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View, FlatList } from "react-native";
import { getAttemptDetail, type AttemptDetail } from "../../../src/lib/mypage";
import { colors } from "../../../src/theme/colors";

// 응시 상세: 한 응시의 문항별 정/오답 + 문제 이미지. 정답은 표시하지 않는다
// (RLS 차단) — is_correct 와 내 선택만 보여준다. 기본은 틀린 문항만.
export default function AttemptDetailScreen() {
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();
  const [detail, setDetail] = useState<AttemptDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyWrong, setOnlyWrong] = useState(true);

  useEffect(() => {
    if (!attemptId) return;
    getAttemptDetail(String(attemptId))
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [attemptId]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!detail) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.textMuted }}>기록을 찾을 수 없어요.</Text>
      </View>
    );
  }

  const shown = onlyWrong ? detail.questions.filter((q) => !q.isCorrect) : detail.questions;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: "응시 기록" }} />
      <FlatList
        data={shown}
        keyExtractor={(q) => String(q.questionNumber)}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
        ListHeaderComponent={
          <View style={{ gap: 8, paddingBottom: 8 }}>
            <Text style={{ fontSize: 17, fontWeight: "700" }}>{detail.title}</Text>
            <Text style={{ color: colors.textMuted }}>
              {detail.score}/{detail.totalQuestions} · {new Date(detail.createdAt).toLocaleDateString("ko-KR")}
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Toggle label="틀린 문항" active={onlyWrong} onPress={() => setOnlyWrong(true)} />
              <Toggle label="전체" active={!onlyWrong} onPress={() => setOnlyWrong(false)} />
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={{ color: colors.textMuted, textAlign: "center", padding: 24 }}>
            {onlyWrong ? "틀린 문항이 없어요. 완벽해요!" : "문항이 없어요."}
          </Text>
        }
        renderItem={({ item: q }) => (
          <View
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: "hidden" }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                padding: 10,
              }}
            >
              <Text style={{ fontWeight: "600" }}>{q.questionNumber}번</Text>
              <Text
                style={{ fontWeight: "700", color: q.isCorrect ? "#16a34a" : colors.danger }}
              >
                {q.isCorrect ? "정답" : "오답"} · 내 답 {q.selectedChoice ?? "-"}
              </Text>
            </View>
            {q.images.map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={{ width: "100%", aspectRatio: 0.75 }}
                contentFit="contain"
              />
            ))}
          </View>
        )}
      />
    </View>
  );
}

function Toggle({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Text
      onPress={onPress}
      style={{
        overflow: "hidden",
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 6,
        fontSize: 13,
        color: active ? colors.primaryText : colors.text,
        backgroundColor: active ? colors.primary : colors.card,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      {label}
    </Text>
  );
}
