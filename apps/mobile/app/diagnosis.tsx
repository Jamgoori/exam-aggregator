import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  requestDiagnosis,
  type AiDiagnosisReport,
} from "../src/lib/diagnosis";
import { useColors } from "../src/theme/colors";

// AI 약점 진단: 버튼 → Edge Function(Claude) 생성 → 리포트 표시. 하루 1회.
export default function DiagnosisScreen() {
  const colors = useColors();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AiDiagnosisReport | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const r = await requestDiagnosis();
      setReport(r.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "진단 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: "AI 약점 진단" }} />

      {!report ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 }}>
          <Text style={{ color: colors.textMuted, textAlign: "center", lineHeight: 20 }}>
            지금까지의 응시·오답을 분석해{"\n"}약점 과목과 개념을 정리해 드려요.{"\n"}(하루 1회)
          </Text>
          {error && (
            <Text style={{ color: colors.danger, textAlign: "center" }}>{error}</Text>
          )}
          <Pressable
            onPress={run}
            disabled={loading}
            style={{
              backgroundColor: loading ? colors.border : colors.primary,
              borderRadius: 12,
              paddingHorizontal: 24,
              paddingVertical: 12,
              flexDirection: "row",
              gap: 8,
              alignItems: "center",
            }}
          >
            {loading && <ActivityIndicator color={colors.primaryText} />}
            <Text style={{ color: colors.primaryText, fontWeight: "600" }}>
              {loading ? "분석 중..." : "진단 받기"}
            </Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 32 }}>
          <View>
            <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 6 }}>요약</Text>
            <Text style={{ lineHeight: 21 }}>{report.summary}</Text>
          </View>

          {report.weakConcepts.length > 0 && (
            <View>
              <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>약점 개념</Text>
              <View style={{ gap: 8 }}>
                {report.weakConcepts.map((w, i) => (
                  <View
                    key={i}
                    style={{
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 12,
                      padding: 12,
                      gap: 4,
                    }}
                  >
                    <Text style={{ fontWeight: "600" }}>
                      {w.concept}
                      {w.subject ? (
                        <Text style={{ color: colors.textMuted, fontWeight: "400" }}> · {w.subject}</Text>
                      ) : null}
                    </Text>
                    {(w.wrongCount != null || w.resolvedCount != null) && (
                      <Text style={{ fontSize: 12, color: colors.textMuted }}>
                        {w.wrongCount != null ? `오답 ${w.wrongCount}` : ""}
                        {w.resolvedCount != null ? ` · 극복 ${w.resolvedCount}` : ""}
                      </Text>
                    )}
                    {w.subjectSlug && (
                      <Pressable onPress={() => router.push(`/wrong-notes/${w.subjectSlug}`)}>
                        <Text style={{ color: colors.primary, fontSize: 13, marginTop: 2 }}>
                          이 과목 오답 보기 ›
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}

          {report.subjectTrends.length > 0 && (
            <View>
              <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>과목 추세</Text>
              <View style={{ gap: 8 }}>
                {report.subjectTrends.map((t, i) => (
                  <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
                    <Text style={{ fontSize: 16 }}>
                      {t.trend === "up" ? "📈" : t.trend === "down" ? "📉" : "➖"}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "600" }}>{t.subject}</Text>
                      <Text style={{ fontSize: 13, color: colors.textMuted }}>{t.note}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          <Text style={{ fontSize: 11, color: colors.textMuted, textAlign: "center" }}>
            AI가 생성한 참고용 진단이에요.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
