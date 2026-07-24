import { Image } from "expo-image";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  getPaperExplanations,
  type ExplanationsResult,
} from "../../../src/lib/explanations";
import { useAuth } from "../../../src/providers/auth-provider";
import { colors } from "../../../src/theme/colors";

// 문제지 전체 해설. 웹 papers/[id]/explanations 포팅. 정답·해설은 서버(Edge Function)
// 만 읽을 수 있어(RLS 차단) 클라이언트는 그 결과를 그대로 보여준다. 비로그인/한도초과는
// 서버가 이미 미리보기 문항만 내려주므로(hiddenCount>0), 화면은 안내만 얹는다.
export default function ExplanationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const paperId = String(id ?? "");
  const { session } = useAuth();
  const [result, setResult] = useState<ExplanationsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!paperId) return;
    getPaperExplanations(paperId)
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : "해설을 불러오지 못했어요."))
      .finally(() => setLoading(false));
  }, [paperId]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error || !result) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: colors.textMuted, textAlign: "center" }}>{error}</Text>
      </View>
    );
  }

  if (result.totalCount === 0) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 }}>
        <Text style={{ fontWeight: "600" }}>아직 해설이 등록되지 않은 문제지예요</Text>
        <Text style={{ color: colors.textMuted, textAlign: "center", fontSize: 13 }}>
          해설이 준비되면 이곳에서 문항별 해설을 볼 수 있어요.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: "해설" }} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
        <Text style={{ color: colors.textMuted, fontSize: 13 }}>{result.totalCount}문항 해설</Text>

        {result.questions.map((q) => (
          <View
            key={q.questionNumber}
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: "hidden" }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", padding: 10 }}>
              <Text style={{ fontWeight: "700" }}>{q.questionNumber}번</Text>
              {q.correctChoice != null && (
                <Text style={{ color: "#16a34a", fontWeight: "700" }}>정답 {q.correctChoice}</Text>
              )}
            </View>
            {q.images.map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={{ width: "100%", aspectRatio: 0.75 }}
                contentFit="contain"
              />
            ))}
            <View style={{ padding: 12, gap: 8 }}>
              {q.explanation.keywordTitle && (
                <Text style={{ fontWeight: "700", fontSize: 14 }}>
                  {q.explanation.keywordTitle}
                </Text>
              )}
              {q.explanation.keywordExplanation && (
                <Text style={{ fontSize: 13, lineHeight: 19 }}>
                  {q.explanation.keywordExplanation}
                </Text>
              )}
              {q.explanation.choiceExplanations.map((c) => (
                <View key={c.choice} style={{ flexDirection: "row", gap: 6 }}>
                  <Text style={{ fontWeight: "600", fontSize: 13 }}>{c.choice}.</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, lineHeight: 19 }}>{c.text}</Text>
                    {c.currentStatus && (
                      <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                        현재 상태: {c.currentStatus}
                        {c.originalNote ? ` · ${c.originalNote}` : ""}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
              {q.explanation.correctChoiceSummary && (
                <Text style={{ fontSize: 13, color: colors.textMuted, fontStyle: "italic" }}>
                  {q.explanation.correctChoiceSummary}
                </Text>
              )}
              {q.explanation.lawAmendmentNote && (
                <Text style={{ fontSize: 12, color: "#d97706" }}>
                  ⚠ {q.explanation.lawAmendmentNote}
                </Text>
              )}
            </View>
          </View>
        ))}

        {result.hiddenCount > 0 && (
          <View
            style={{
              alignItems: "center",
              gap: 10,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 24,
            }}
          >
            {result.loggedIn ? (
              <>
                <Text style={{ fontWeight: "600" }}>잠시 후 다시 시도해주세요</Text>
                <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: "center" }}>
                  요청이 많아 전체 해설 표시가 일시적으로 제한됐어요.
                </Text>
              </>
            ) : (
              <>
                <Text style={{ fontWeight: "600", textAlign: "center" }}>
                  나머지 {result.hiddenCount}문항 해설은 로그인하면 볼 수 있어요
                </Text>
                <Link href="/(auth)/login" asChild>
                  <Pressable
                    style={{
                      backgroundColor: colors.primary,
                      borderRadius: 10,
                      paddingHorizontal: 20,
                      paddingVertical: 10,
                      marginTop: 4,
                    }}
                  >
                    <Text style={{ color: colors.primaryText, fontWeight: "600" }}>
                      로그인하고 전체 해설 보기
                    </Text>
                  </Pressable>
                </Link>
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
