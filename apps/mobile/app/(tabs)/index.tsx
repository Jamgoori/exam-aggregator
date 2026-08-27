import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { CONSONANTS, LEVEL_ORDER, type ExamPaper } from "@gongmoa/core";
import { ExamCard } from "../../src/components/exam-card";
import { OfflineBanner } from "../../src/components/offline-banner";
import {
  browsePapers,
  browsePapersCached,
  collapsePapers,
  getCbtAvailability,
  getMyBookmarkedPaperIds,
  getMyRoundCounts,
} from "../../src/lib/papers";
import { setBookmark } from "../../src/lib/paper-detail";
import { getMyBookmarkedSubjectIds } from "../../src/lib/subjects";
import { readCache, writeCache } from "../../src/lib/offline";
import { getWrongNoteGroupsCached } from "../../src/lib/wrong-notes";
import { useAuth } from "../../src/providers/auth-provider";
import { levelBadge } from "../../src/theme/badges";
import { useColors } from "../../src/theme/colors";

// 홈. 화면 구성·순서를 웹 모바일 화면(home-exam-browser)에 맞춘다:
// 소개 문구 → 검색 → 오답노트 배너 → 급수 탭 → 가나다 인덱스 → "총 N개의 자료" → 카드.
// (웹의 통계 타일 3개는 모바일 폭에서 의도적으로 숨기고 총 자료 수만 소개 문장에 넣는다 —
//  home-exam-browser.tsx 주석 참고. 앱도 같게 둔다.)
//
// 데이터를 받는 방식만 다르다: 웹은 전체 목록을 받아 브라우저에서 거르고, 앱은 같은 검색
// 규칙(@gongmoa/core)을 서버 쿼리로 내려 20건씩 이어받는다.
export default function HomeScreen() {
  const colors = useColors();
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
  const [stale, setStale] = useState(false);

  const [rounds, setRounds] = useState<Map<string, number>>(new Map());
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [cbtSet, setCbtSet] = useState<Set<string>>(new Set());
  const [unresolved, setUnresolved] = useState(0);
  // "즐겨찾기한 과목만 보기" — 웹처럼 선택을 기억하고, 로그아웃 상태에선 걸지 않는다.
  const [favOnly, setFavOnly] = useState(false);
  const [favSubjectIds, setFavSubjectIds] = useState<string[]>([]);
  const effectiveFavOnly = favOnly && !!session;

  // 저장해둔 토글 상태를 복원한다(웹은 localStorage, 앱은 같은 파일 캐시를 쓴다).
  useEffect(() => {
    readCache<boolean>("home:favOnly")
      .then((c) => c && setFavOnly(c.data))
      .catch(() => {});
  }, []);

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
    const subjectIds = effectiveFavOnly ? favSubjectIds : undefined;
    // 캐시는 필터 없는 기본 목록에만 쓴다(조합마다 캐시를 만들면 금방 지저분해진다).
    const load =
      debounced.trim() || subjectIds
        ? browsePapers({ query: debounced, level, subjectIds }, 0)
        : browsePapersCached(level);
    load
      .then((r) => {
        if (!alive) return;
        setPapers(r.papers);
        setHasMore(r.hasMore);
        setStale(!!r.fromCache);
        setPage(0);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [debounced, level, effectiveFavOnly, favSubjectIds]);

  // 사용자별 값(회독·즐겨찾기·남은 오답)은 목록과 따로 받는다(첫 화면을 막지 않게).
  useFocusEffect(
    useCallback(() => {
      if (!session) {
        setRounds(new Map());
        setBookmarks(new Set());
        setUnresolved(0);
        return;
      }
      let alive = true;
      getMyRoundCounts()
        .then((m) => alive && setRounds(m))
        .catch(() => {});
      getMyBookmarkedPaperIds()
        .then((b) => alive && setBookmarks(b))
        .catch(() => {});
      getMyBookmarkedSubjectIds()
        .then((ids) => alive && setFavSubjectIds(ids))
        .catch(() => {});
      getWrongNoteGroupsCached()
        .then(({ groups }) => {
          if (!alive) return;
          setUnresolved(groups.reduce((s, g) => s + g.unresolvedCount, 0));
        })
        .catch(() => {});
      return () => {
        alive = false;
      };
    }, [session]),
  );

  // 같은 시험지를 직류만 다르게 올린 행을 한 장으로 합친다(웹과 같은 규칙).
  // 페이지 단위가 아니라 지금까지 받은 전체에 적용해야, 한 그룹이 페이지 경계에 걸쳐도
  // 다음 페이지를 받는 순간 합쳐진다.
  const visiblePapers = useMemo(() => collapsePapers(papers), [papers]);

  // "바로 풀기" 배지는 보이는 문제지만 한 번에 확인한다(웹 getCbtAvailability 와 같은 RPC).
  useEffect(() => {
    if (visiblePapers.length === 0) return;
    let alive = true;
    getCbtAvailability(visiblePapers.map((p) => p.id))
      .then((s) => alive && setCbtSet(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [visiblePapers]);

  const loadingMoreRef = useRef(false);
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || loading) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const r = await browsePapers(
        {
          query: debounced,
          level,
          subjectIds: effectiveFavOnly ? favSubjectIds : undefined,
        },
        next,
      );
      setPapers((prev) => [...prev, ...r.papers]);
      setHasMore(r.hasMore);
      setPage(next);
    } catch {
      setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [debounced, level, page, hasMore, loading, effectiveFavOnly, favSubjectIds]);

  async function toggleBookmark(paperId: string) {
    const next = !bookmarks.has(paperId);
    // 낙관적 갱신 — 실패하면 되돌린다.
    const apply = (add: boolean) =>
      setBookmarks((prev) => {
        const copy = new Set(prev);
        if (add) copy.add(paperId);
        else copy.delete(paperId);
        return copy;
      });
    apply(next);
    try {
      await setBookmark(paperId, next);
    } catch {
      apply(!next);
    }
  }

  async function toggleFavOnly() {
    if (!session) {
      router.push("/(auth)/login");
      return;
    }
    const next = !favOnly;
    setFavOnly(next);
    await writeCache("home:favOnly", next);
  }

  const latestYear = visiblePapers[0]?.year;

  const header = (
    <View style={{ gap: 12, paddingBottom: 4 }}>
      <OfflineBanner visible={stale} />

      {/* 웹 홈의 소개 영역(모바일 압축본). 통계 타일 대신 총 자료 수를 아래 줄에 둔다. */}
      <View style={{ gap: 8 }}>
        {latestYear != null && (
          <Text
            style={{
              alignSelf: "flex-start",
              fontSize: 11,
              fontWeight: "500",
              color: colors.primary,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 3,
              overflow: "hidden",
            }}
          >
            {latestYear}년 자료 업데이트 완료
          </Text>
        )}
        <Text style={{ fontSize: 26, fontWeight: "700", lineHeight: 34 }}>
          <Text style={{ color: colors.primary }}>공모아</Text>에서 문제풀고{"\n"}오답노트, AI 약점진단 받으세요
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
          국가직·지방직·소방·경찰 등 주요 공무원 시험 기출문제를 연도별·과목별로 정리했어요.
        </Text>
      </View>

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

      {/* 오답노트 바로가기 — 웹도 검색창 바로 아래에 둔다. */}
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
            <Text style={{ color: colors.danger, fontWeight: "700" }}>{unresolved}개</Text> 있어요.
          </Text>
          <Text style={{ color: colors.danger, fontSize: 13, fontWeight: "600" }}>
            오답노트 ›
          </Text>
        </Pressable>
      )}

      {/* 즐겨찾기한 과목만 보기 — 웹과 같은 자리(급수 탭 바로 위). */}
      <Pressable
        onPress={toggleFavOnly}
        style={{
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 16,
          paddingVertical: 6,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: effectiveFavOnly ? "#f59e0b" : colors.border,
        }}
      >
        <Text style={{ color: effectiveFavOnly ? "#f59e0b" : colors.textMuted, fontSize: 13 }}>
          {effectiveFavOnly ? "★" : "☆"} 즐겨찾기한 과목만 보기
        </Text>
      </Pressable>

      {/* 급수 탭: 웹처럼 선택된 급수는 그 급수의 배지 색으로 채운다. */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <LevelChip label="전체" active={!level} onPress={() => setLevel(undefined)} />
        {LEVEL_ORDER.map((lv) => (
          <LevelChip
            key={lv}
            label={lv}
            active={level === lv}
            activeColors={levelBadge(lv)}
            onPress={() => setLevel(lv)}
          />
        ))}
      </View>

      {/* 가나다 인덱스: 웹은 초성을 누르면 그 초성 과목 목록을 띄운다. 앱은 과목 화면으로
          같은 초성이 선택된 상태로 넘긴다. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingRight: 8 }}
        style={{ flexGrow: 0 }}
      >
        {CONSONANTS.map((c) => (
          <Pressable
            key={c}
            onPress={() => router.push(`/subjects?consonant=${encodeURIComponent(c)}`)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 13, color: colors.textMuted }}>{c}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={{ color: colors.textMuted, fontSize: 13 }}>
        총 {visiblePapers.length}개의 자료
      </Text>
    </View>
  );

  return (
    <FlatList
      data={visiblePapers}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      onEndReached={loadMore}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : error ? (
          <Text style={{ color: colors.danger, textAlign: "center", padding: 24 }}>{error}</Text>
        ) : (
          <Text style={{ color: colors.textMuted, textAlign: "center", padding: 24 }}>
            {effectiveFavOnly && favSubjectIds.length === 0
              ? "아직 즐겨찾기한 과목이 없어요. 과목별 보기에서 별 아이콘을 눌러 추가해보세요."
              : "조건에 맞는 기출문제가 없습니다."}
          </Text>
        )
      }
      ListFooterComponent={
        loadingMore ? <ActivityIndicator style={{ marginVertical: 16 }} /> : null
      }
      renderItem={({ item, index }) => (
        <>
          {/* 즐겨찾기 보기에서는 웹처럼 연도로 묶어 보여준다(연도가 바뀌는 자리에 머리글). */}
          {effectiveFavOnly && visiblePapers[index - 1]?.year !== item.year && (
            <Text style={{ fontSize: 17, fontWeight: "700", marginTop: index === 0 ? 0 : 8 }}>
              {item.year}년
            </Text>
          )}
          <ExamCard
            paper={item}
            myRoundCount={rounds.get(item.id)}
            bookmarked={bookmarks.has(item.id)}
            cbtAvailable={cbtSet.has(item.id)}
            onToggleBookmark={session ? () => toggleBookmark(item.id) : undefined}
          />
        </>
      )}
    />
  );
}

function LevelChip({
  label,
  active,
  activeColors,
  onPress,
}: {
  label: string;
  active: boolean;
  // 급수 칩은 선택되면 그 급수 색으로 채운다. "전체"는 웹처럼 진한 회색.
  activeColors?: { bg: string; fg: string };
  onPress: () => void;
}) {
  const colors = useColors();
  const bg = active ? (activeColors?.bg ?? "#27272a") : "transparent";
  const fg = active ? (activeColors?.fg ?? "#ffffff") : colors.textMuted;
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 16,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: active ? bg : colors.border,
      }}
    >
      <Text style={{ color: fg, fontSize: 13, fontWeight: "500" }}>{label}</Text>
    </Pressable>
  );
}
