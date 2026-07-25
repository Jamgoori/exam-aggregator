import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { listReviewHistory, type ReviewHistoryEntry } from "../../src/lib/review";
import { colors } from "../../src/theme/colors";

// 지난 섞어풀기 기록. 웹 mypage/wrong-notes/[slug]/review/[sessionId] 처럼 채점이 끝난
// 세션을 다시 열어볼 수 있게 한다.
export default function ReviewHistoryScreen() {
  const router = useRouter();
  const [entries, setEntries] = useState<ReviewHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setLoading(true);
      listReviewHistory()
        .then((rows) => alive && setEntries(rows))
        .catch((e) => alive && setError(e instanceof Error ? e.message : "불러오기 실패"))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, []),
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: "섞어풀기 기록" }} />
      {loading && entries.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 32 }} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.sessionId}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <Text
              style={{
                color: error ? colors.danger : colors.textMuted,
                textAlign: "center",
                padding: 32,
                fontSize: 13,
              }}
            >
              {error ?? "아직 섞어풀기 기록이 없어요."}
            </Text>
          }
          renderItem={({ item }) => {
            const pct =
              item.score != null && item.total > 0
                ? Math.round((item.score / item.total) * 100)
                : null;
            return (
              <Pressable
                onPress={() => router.push(`/review/${item.sessionId}`)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "500" }}>
                    {item.subjectName ?? "전체 과목"}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                    {new Date(item.submittedAt).toLocaleDateString("ko-KR")} · {item.total}문항
                  </Text>
                </View>
                <Text style={{ fontWeight: "700" }}>
                  {item.score ?? 0}/{item.total}
                </Text>
                {pct != null && (
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginLeft: 6 }}>
                    {pct}점
                  </Text>
                )}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}
