import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import {
  listSubjects,
  toggleSubjectBookmark,
  type SubjectWithFav,
} from "../../src/lib/subjects";
import { useAuth } from "../../src/providers/auth-provider";
import { colors } from "../../src/theme/colors";

// 과목별 보기: 과목 목록(즐겨찾기 별). 즐겨찾기 과목을 위로 정렬.
export default function SubjectsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [subjects, setSubjects] = useState<SubjectWithFav[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSubjects()
      .then(setSubjects)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggleFav(s: SubjectWithFav) {
    if (!session) return;
    const next = !s.favorited;
    setSubjects((prev) => prev.map((x) => (x.id === s.id ? { ...x, favorited: next } : x)));
    try {
      await toggleSubjectBookmark(s.id, next);
    } catch {
      setSubjects((prev) => prev.map((x) => (x.id === s.id ? { ...x, favorited: !next } : x)));
    }
  }

  const sorted = [...subjects].sort(
    (a, b) => Number(b.favorited) - Number(a.favorited),
  );

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: "과목별 보기" }} />
      <FlatList
        data={sorted}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item: s }) => (
          <View style={rowStyle}>
            <Pressable
              onPress={() => router.push(`/subjects/${s.slug}`)}
              style={{ flex: 1 }}
            >
              <Text style={{ fontSize: 15, fontWeight: "500" }}>{s.name}</Text>
            </Pressable>
            {session && (
              <Pressable onPress={() => toggleFav(s)} hitSlop={8}>
                <Text style={{ fontSize: 20, color: s.favorited ? "#f59e0b" : colors.border }}>
                  {s.favorited ? "★" : "☆"}
                </Text>
              </Pressable>
            )}
            <Text style={{ color: colors.textMuted, marginLeft: 10 }}>›</Text>
          </View>
        )}
      />
    </View>
  );
}

const rowStyle = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  paddingHorizontal: 8,
  paddingVertical: 14,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
};
