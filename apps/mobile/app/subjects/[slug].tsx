import { Link, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { getSubjectBySlug, papersBySubject } from "../../src/lib/subjects";
import { getPaperDisplayTitle, type ExamPaper } from "@gongmoa/core";
import { colors } from "../../src/theme/colors";

// 과목별 문제지 목록.
export default function SubjectPapersScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [title, setTitle] = useState("");
  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) return;
    getSubjectBySlug(String(slug))
      .then(async (subject) => {
        if (!subject) return;
        setTitle(subject.name);
        setPapers(await papersBySubject(subject.id));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: title || "과목" }} />
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={papers}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={
            <Text style={{ color: colors.textMuted, textAlign: "center", padding: 24 }}>
              이 과목의 문제지가 없어요.
            </Text>
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
                <Text style={{ fontWeight: "600", fontSize: 15 }} numberOfLines={1}>
                  {getPaperDisplayTitle(item.title, item.track)}
                </Text>
                <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 13 }}>
                  {item.year}년 {item.round}회{item.level ? ` · ${item.level}` : ""}
                </Text>
              </Pressable>
            </Link>
          )}
        />
      )}
    </View>
  );
}
