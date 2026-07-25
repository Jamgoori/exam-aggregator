import { Link, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { getPaperDisplayTitle, LEVEL_ORDER, type ExamPaper } from "@gongmoa/core";
import { browsePapers, getMyRoundCounts } from "../../src/lib/papers";
import { roundBadge } from "../../src/lib/round-tier";
import { getWrongNoteGroups } from "../../src/lib/wrong-notes";
import { useAuth } from "../../src/providers/auth-provider";
import { colors } from "../../src/theme/colors";

// 홈: 검색 + 급수 필터 + 무한 스크롤 목록. 웹 home-exam-browser 가 전체 목록(3천여 건)을
// 받아 브라우저에서 필터하는 것과 달리, 앱은 같은 검색 규칙(@gongmoa/core 의
// parseSearchQuery/matchSubjectIds)을 서버 쿼리로 내리고 페이지 단위로 이어받는다.
export default function HomeScreen() {
  const router = useRouter();
  const { session } = useAuth();

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [level, setLevel] = useState<string | undefined>(undefined);

  const [papers, setPapers] = useState<ExamPaper[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [rounds, setRounds] = useState<Map<string, number>>(new Map());
  const [unresolved, setUnresolved] = useState(0);

  // 입력할 때마다 쿼리를 날리지 않도록 300ms 모아서 보낸다.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  // 검색어·급수가 바뀌면 처음부터 다시 받는다.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    browsePapers({ query: debounced, level }, 0)
      .then((r) => {
        if (!alive) return;
        setPapers(r.papers);
        setHasMore(r.hasMore);
        setPage(0);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [debounced, level]);

  // 회독 배지·오답 배너는 사용자별 값이라 목록과 따로 받는다(첫 화면을 막지 않게).
  // CBT 를 풀고 돌아오면 값이 달라지므로 포커스마다 갱신한다.
  useFocusEffect(
    useCallback(() => {
      if (!session) {
        setRounds(new Map());
        setUnresolved(0);
        return;
      }
      let alive = true;
      getMyRoundCounts()
        .then((m) => alive && setRounds(m))
        .catch(() => {});
      getWrongNoteGroups()
        .then((groups) => {
          if (!alive) return;
          setUnresolved(groups.reduce((s, g) => s + g.unresolvedCount, 0));
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [session]),
  );

  // onEndReached 는 스크롤 중 여러 번 불릴 수 있어 진행 중 호출을 막는다.
  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || loading) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const r = await browsePapers({ query: debounced, level }, next);
      setPapers((prev) => [...prev, ...r.papers]);
      setHasMore(r.hasMore);
      setPage(next);
    } catch {
      setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [debounced, level, page, hasMore, loading]);

  const header = (
    <View style={{ gap: 10, paddingBottom: 4 }}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="과목·연도·급수로 검색 (예: 7급 행정법)"
        placeholderTextColor={colors.textMuted}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
          backgroundColor: colors.card,
          color: colors.text,
        }}
        returnKeyType="search"
        autoCorrect={false}
      />

      <View style={{ flexDirection: "row", gap: 6 }}>
        <Chip label="전체" active={!level} onPress={() => setLevel(undefined)} />
        {LEVEL_ORDER.map((l) => (
          <Chip key={l} label={l} active={level === l} onPress={() => setLevel(l)} />
        ))}
      </View>

      {unresolved > 0 && (
        <Pressable
          onPress={() => router.push("/(tabs)/mypage")}
          style={{
            borderWidth: 1,
            borderColor: colors.danger,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Text style={{ flex: 1, fontSize: 13 }}>
            아직 극복 못 한 오답이{" "}
            <Text style={{ color: colors.danger, fontWeight: "700" }}>{unresolved}개</Text>{" "}
            있어요.
          </Text>
          <Text style={{ color: colors.danger, fontSize: 13, fontWeight: "600" }}>
            오답노트 ›
          </Text>
        </Pressable>
      )}

      <Link href="/subjects" asChild>
        <Pressable
          style={{
            borderWidth: 1,
            borderColor: colors.primary,
            borderRadius: 12,
            padding: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.primary, fontWeight: "600" }}>과목별 보기 ›</Text>
        </Pressable>
      </Link>
    </View>
  );

  return (
    <FlatList
      data={papers}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={{ color: colors.danger, textAlign: "center", padding: 24 }}>
            {error}
          </Text>
        ) : (
          <Text style={{ color: colors.textMuted, textAlign: "center", padding: 24 }}>
            조건에 맞는 문제지가 없어요.
          </Text>
        )
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null
      }
      renderItem={({ item }) => {
        const round = rounds.get(item.id) ?? 0;
        const badge = round > 0 ? roundBadge(round) : null;
        return (
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text
                  style={{ fontWeight: "600", fontSize: 15, flex: 1 }}
                  numberOfLines={2}
                >
                  {getPaperDisplayTitle(item.title, item.track)}
                </Text>
                {badge && (
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "700",
                      color: badge.fg,
                      backgroundColor: badge.bg,
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      overflow: "hidden",
                    }}
                  >
                    {round}회독
                  </Text>
                )}
              </View>
              <Text style={{ color: colors.textMuted, marginTop: 4, fontSize: 13 }}>
                {item.year}년 {item.round}회
                {item.level ? ` · ${item.level}` : ""}
                {item.subjects?.name ? ` · ${item.subjects.name}` : ""}
              </Text>
            </Pressable>
          </Link>
        );
      }}
    />
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
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 999,
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
