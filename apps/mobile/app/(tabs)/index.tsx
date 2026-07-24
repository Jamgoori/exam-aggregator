import { Link } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { listPapers } from "../../src/lib/papers";
import type { ExamPaper } from "@gongmoa/core";
import { colors } from "../../src/theme/colors";

// 홈: 최신 문제지 목록. 웹 home-exam-browser 의 앱 최소판.
export default function HomeScreen() {
  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPapers()
      .then(setPapers)
      .catch((e) => setError(e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: colors.danger }}>{error}</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={papers}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      ListHeaderComponent={
        <Link href="/subjects" asChild>
          <Pressable
            style={{
              borderWidth: 1,
              borderColor: colors.primary,
              borderRadius: 12,
              padding: 14,
              alignItems: "center",
              marginBottom: 2,
            }}
          >
            <Text style={{ color: colors.primary, fontWeight: "600" }}>과목별 보기 ›</Text>
          </Pressable>
        </Link>
      }
      renderItem={({ item }) => (
        <Link href={`/papers/${item.id}`} asChild>
          <Pressable
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 14,
              backgroundColor: colors.card,
            }}
          >
            <Text style={{ fontWeight: "600", fontSize: 15 }}>{item.title}</Text>
            <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 13 }}>
              {item.year}년 {item.round}회
              {item.level ? ` · ${item.level}` : ""}
              {item.subjects?.name ? ` · ${item.subjects.name}` : ""}
            </Text>
          </Pressable>
        </Link>
      )}
    />
  );
}
