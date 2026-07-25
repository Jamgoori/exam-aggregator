import { Stack, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { CONSONANTS, initialConsonant } from "@gongmoa/core";
import {
  listSubjectsCached,
  toggleSubjectBookmark,
  type SubjectWithFav,
} from "../../src/lib/subjects";
import { useAuth } from "../../src/providers/auth-provider";
import { useColors, type Colors } from "../../src/theme/colors";

// 과목별 보기: 과목 목록(즐겨찾기 별) + 가나다 인덱스. 과목이 160개가 넘어 스크롤로만
// 찾기 어려워서, 웹 subject-index-tabs 처럼 초성으로 좁힐 수 있게 한다. 초성 판정은
// @gongmoa/core 의 initialConsonant 라 웹과 같은 규칙이다.
export default function SubjectsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { session } = useAuth();
  const [subjects, setSubjects] = useState<SubjectWithFav[]>([]);
  const [consonant, setConsonant] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSubjectsCached()
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

  const visible = useMemo(() => {
    const filtered = consonant
      ? subjects.filter((s) => initialConsonant(s.name) === consonant)
      : subjects;
    return [...filtered].sort((a, b) => Number(b.favorited) - Number(a.favorited));
  }, [subjects, consonant]);

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

      {/* 초성 칩 14개를 세로로 쌓으면 첫 화면에서 목록을 밀어내서, 한 줄 가로 스크롤로 둔다
          (웹도 모바일 폭에서 같은 처리를 한다). */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10, gap: 6 }}
        style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border }}
      >
        <Chip label="전체" active={!consonant} onPress={() => setConsonant(null)} />
        {CONSONANTS.map((c) => (
          <Chip
            key={c}
            label={c}
            active={consonant === c}
            onPress={() => setConsonant(consonant === c ? null : c)}
          />
        ))}
      </ScrollView>

      <FlatList
        data={visible}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={
          <Text
            style={{
              color: colors.textMuted,
              textAlign: "center",
              padding: 32,
              fontSize: 13,
            }}
          >
            {consonant ? `'${consonant}' 로 시작하는 과목이 없어요.` : "과목이 없어요."}
          </Text>
        }
        renderItem={({ item: s }) => (
          <View style={rowStyle(colors)}>
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

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        minWidth: 34,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        alignItems: "center",
        backgroundColor: active ? colors.primary : colors.card,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Text style={{ color: active ? colors.primaryText : colors.text, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const rowStyle = (colors: Colors) => ({
  flexDirection: "row" as const,
  alignItems: "center" as const,
  paddingHorizontal: 8,
  paddingVertical: 14,
  borderBottomWidth: 1,
  borderBottomColor: colors.border,
});
