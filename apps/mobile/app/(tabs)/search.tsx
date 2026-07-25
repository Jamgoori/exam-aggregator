import { Link } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { searchPapers } from "../../src/lib/search";
import { getPaperDisplayTitle, type ExamPaper } from "@gongmoa/core";
import { colors } from "../../src/theme/colors";

export default function SearchScreen() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ExamPaper[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // 검색 경합 방지: 마지막으로 던진 쿼리의 응답만 반영한다.
  const latest = useRef("");

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!q) {
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    // 입력 멈춘 뒤 300ms 디바운스.
    const t = setTimeout(() => {
      searchPapers(q)
        .then((papers) => {
          if (latest.current !== q) return; // 더 최신 쿼리가 있으면 버린다.
          setResults(papers);
          setSearched(true);
        })
        .catch(() => {
          if (latest.current === q) setResults([]);
        })
        .finally(() => {
          if (latest.current === q) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ padding: 16 }}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="과목·연도·급수 검색 (초성도 돼요, 예: ㄱㅇ)"
          placeholderTextColor={colors.textMuted}
          autoCorrect={false}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
            color: colors.text,
          }}
        />
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 8 }} />}

      <FlatList
        data={results}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 10 }}
        ListEmptyComponent={
          !loading && searched ? (
            <Text
              style={{ color: colors.textMuted, textAlign: "center", padding: 24, fontSize: 13 }}
            >
              검색 결과가 없어요.
            </Text>
          ) : null
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
                {item.year}년 {item.round}회
                {item.level ? ` · ${item.level}` : ""}
                {item.subjects?.name ? ` · ${item.subjects.name}` : ""}
              </Text>
            </Pressable>
          </Link>
        )}
      />
    </View>
  );
}
