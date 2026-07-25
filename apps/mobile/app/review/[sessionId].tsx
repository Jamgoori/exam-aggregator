import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { getReviewResult, type ReviewResult } from "../../src/lib/review";
import { colors } from "../../src/theme/colors";

// 지난 섞어풀기 결과 다시 보기. 채점이 끝난 세션이라 정답을 함께 보여준다
// (채점 전 세션은 서버가 내려주지 않는다 — review-history 함수 주석 참고).
export default function ReviewResultScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let alive = true;
    getReviewResult(String(sessionId))
      .then((r) => alive && setResult(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Stack.Screen options={{ headerShown: true, title: "섞어풀기 결과" }} />
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !result) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Stack.Screen options={{ headerShown: true, title: "섞어풀기 결과" }} />
        <Text style={{ color: colors.danger, textAlign: "center" }}>
          {error ?? "결과를 찾을 수 없어요."}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: "섞어풀기 결과" }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>
        <Text style={{ fontSize: 20, fontWeight: "700" }}>
          {result.score}/{result.total}
        </Text>

        {result.items.map((item) => (
          <View
            key={item.position}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              overflow: "hidden",
              backgroundColor: colors.card,
            }}
          >
            <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 2 }}>
              {item.paperTitle && (
                <Text style={{ color: colors.textMuted, fontSize: 11 }} numberOfLines={1}>
                  {item.paperTitle}
                  {item.questionNumber != null ? ` · ${item.questionNumber}번` : ""}
                </Text>
              )}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text
                  style={{
                    fontWeight: "700",
                    color: item.isCorrect ? "#16a34a" : colors.danger,
                  }}
                >
                  {item.isCorrect ? "정답" : "오답"}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  내 답 {item.selectedChoice ?? "-"} · 정답 {item.correctChoice ?? "-"}
                </Text>
              </View>
            </View>

            {item.images.length === 0 ? (
              <Text style={{ color: colors.textMuted, fontSize: 12, padding: 12 }}>
                문항 이미지가 없어요.
              </Text>
            ) : (
              <View style={{ marginTop: 8 }}>
                {item.images.map((uri) => (
                  <Image
                    key={uri}
                    source={{ uri }}
                    style={{ width: "100%", aspectRatio: 0.75 }}
                    contentFit="contain"
                    transition={100}
                  />
                ))}
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
