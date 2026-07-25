import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";
import { signOut } from "../../src/lib/auth";
import { formatDuration } from "@gongmoa/core";
import {
  computeAttemptRounds,
  getMyAttempts,
  getMyBookmarks,
  type MyAttempt,
} from "../../src/lib/mypage";
import {
  getWrongNoteGroups,
  toSubjectSummaries,
  type WrongNoteSubjectSummary,
} from "../../src/lib/wrong-notes";
import { computeStreakDays, streakTier } from "../../src/lib/streak";
import { getPaperDisplayTitle, type ExamPaper } from "@gongmoa/core";
import { useAuth } from "../../src/providers/auth-provider";
import { useColors, type Colors } from "../../src/theme/colors";

type Tab = "history" | "bookmarks" | "wrong";

export default function MyPageScreen() {
  const colors = useColors();
  const { session } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("history");
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState<MyAttempt[]>([]);
  const [bookmarks, setBookmarks] = useState<ExamPaper[]>([]);
  const [wrong, setWrong] = useState<WrongNoteSubjectSummary[]>([]);

  // 화면에 들어올 때마다 새로고침(CBT 채점 후 돌아오면 기록·오답이 갱신돼야 함).
  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      let alive = true;
      setLoading(true);
      Promise.all([getMyAttempts(), getMyBookmarks(), getWrongNoteGroups()])
        .then(([a, b, groups]) => {
          if (!alive) return;
          setAttempts(a);
          setBookmarks(b);
          setWrong(toSubjectSummaries(groups));
        })
        .catch(() => {})
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, [session]),
  );

  if (!session) {
    return (
      <Centered>
        <Text style={{ color: colors.textMuted, marginBottom: 12 }}>
          로그인이 필요해요.
        </Text>
        <Pressable onPress={() => router.push("/(auth)/login")} style={primaryBtn(colors)}>
          <Text style={{ color: colors.primaryText, fontWeight: "500" }}>로그인</Text>
        </Pressable>
        {/* 비로그인 상태에서도 약관·처리방침에 닿아야 한다(스토어 심사 확인 항목). */}
        <Pressable onPress={() => router.push("/settings")} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>설정 · 약관</Text>
        </Pressable>
      </Centered>
    );
  }

  const nickname =
    (session.user.user_metadata?.nickname as string | undefined) ??
    session.user.email?.split("@")[0] ??
    "회원";

  const streak = computeStreakDays(attempts.map((a) => a.created_at));
  const tier = streakTier(streak);
  const unresolvedTotal = wrong.reduce((s, w) => s + w.unresolved, 0);
  const roundByAttempt = computeAttemptRounds(attempts);

  const header = (
    <View style={{ padding: 16, gap: 16 }}>
      <View
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 20, fontWeight: "700" }}>{nickname}님</Text>
          <Pressable onPress={() => router.push("/nickname")}>
            <Text style={{ color: colors.primary, fontSize: 13 }}>수정</Text>
          </Pressable>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            onPress={() => router.push("/settings")}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Text style={{ fontSize: 13 }}>설정</Text>
          </Pressable>
          <Pressable
            onPress={signOut}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 6,
            }}
          >
            <Text style={{ color: colors.danger, fontSize: 13 }}>로그아웃</Text>
          </Pressable>
        </View>
      </View>

      {/* 통계 */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <StatCard label="CBT 응시" value={`${attempts.length}`} />
        <StatCard
          label="연속 학습"
          value={`${streak}일`}
          badge={tier ? { label: tier.label, color: tier.color } : null}
        />
        <StatCard
          label="남은 오답"
          value={`${unresolvedTotal}`}
          valueColor={unresolvedTotal > 0 ? colors.danger : colors.success}
        />
      </View>

      {/* 탭 */}
      <View style={{ flexDirection: "row", gap: 6 }}>
        <TabButton label="기록" active={tab === "history"} onPress={() => setTab("history")} />
        <TabButton label="즐겨찾기" active={tab === "bookmarks"} onPress={() => setTab("bookmarks")} />
        <TabButton label="오답노트" active={tab === "wrong"} onPress={() => setTab("wrong")} />
      </View>

      {loading && <ActivityIndicator style={{ marginTop: 8 }} />}
    </View>
  );

  // 탭별 데이터/렌더.
  if (tab === "history") {
    return (
      <FlatList
        ListHeaderComponent={header}
        data={attempts}
        keyExtractor={(a) => a.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={!loading ? <Empty text="아직 CBT로 풀어본 문제가 없어요." /> : null}
        renderItem={({ item: a }) => {
          const pct = a.total_questions > 0 ? Math.round((a.score / a.total_questions) * 100) : 0;
          const round = roundByAttempt.get(a.id);
          return (
            <Pressable
              onPress={() => router.push(`/mypage/attempts/${a.id}`)}
              style={rowStyle(colors)}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: "500" }} numberOfLines={1}>
                  {a.paper?.title ?? "삭제된 문제"}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                  {new Date(a.created_at).toLocaleDateString("ko-KR")}
                  {a.duration_seconds != null ? ` · ${formatDuration(a.duration_seconds)}` : ""}
                  {round ? ` · ${round}회독` : ""}
                </Text>
              </View>
              <Text style={{ fontWeight: "700" }}>
                {a.score}/{a.total_questions}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginLeft: 6 }}>{pct}점</Text>
            </Pressable>
          );
        }}
      />
    );
  }

  if (tab === "bookmarks") {
    return (
      <FlatList
        ListHeaderComponent={header}
        data={bookmarks}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListEmptyComponent={!loading ? <Empty text="아직 즐겨찾기한 문제가 없어요." /> : null}
        renderItem={({ item: p }) => (
          <Pressable onPress={() => router.push(`/papers/${p.id}`)} style={rowStyle(colors)}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "500" }} numberOfLines={1}>
                {getPaperDisplayTitle(p.title, p.track)}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                {p.year}년 {p.round}회{p.subjects?.name ? ` · ${p.subjects.name}` : ""}
              </Text>
            </View>
          </Pressable>
        )}
      />
    );
  }

  // wrong
  const wrongHeader = (
    <View>
      {header}
      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingBottom: 12 }}>
        <Pressable
          onPress={() => router.push("/review")}
          style={{
            flex: 1,
            backgroundColor: colors.primary,
            borderRadius: 10,
            paddingVertical: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.primaryText, fontWeight: "600" }}>섞어풀기</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/review/history")}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            paddingVertical: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "600" }}>지난 기록</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push("/diagnosis")}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.primary,
            borderRadius: 10,
            paddingVertical: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.primary, fontWeight: "600" }}>AI 진단</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <FlatList
      ListHeaderComponent={wrongHeader}
      data={wrong}
      keyExtractor={(w) => w.subjectId}
      contentContainerStyle={{ paddingBottom: 24 }}
      ListEmptyComponent={
        !loading ? <Empty text="아직 모인 오답이 없어요. CBT로 풀면 틀린 문제가 과목별로 정리돼요." /> : null
      }
      renderItem={({ item: w }) => (
        <Pressable onPress={() => router.push(`/wrong-notes/${w.slug}`)} style={rowStyle(colors)}>
          <Text style={{ flex: 1, fontWeight: "500" }}>{w.name}</Text>
          <Text style={{ color: colors.danger, fontWeight: "600" }}>남은 오답 {w.unresolved}</Text>
          <Text style={{ color: colors.textMuted, marginLeft: 8 }}>›</Text>
        </Pressable>
      )}
    />
  );
}

function StatCard({
  label,
  value,
  valueColor,
  badge,
}: {
  label: string;
  value: string;
  valueColor?: string;
  badge?: { label: string; color: string } | null;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        gap: 4,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontSize: 18, fontWeight: "700", color: valueColor ?? colors.text }}>
          {value}
        </Text>
        {badge && (
          <Text
            style={{
              fontSize: 10,
              color: "#fff",
              backgroundColor: badge.color,
              borderRadius: 999,
              paddingHorizontal: 6,
              paddingVertical: 1,
              overflow: "hidden",
            }}
          >
            {badge.label}
          </Text>
        )}
      </View>
    </View>
  );
}

function TabButton({
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
        paddingHorizontal: 14,
        paddingVertical: 7,
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

function Empty({ text }: { text: string }) {
  const colors = useColors();
  return (
    <Text style={{ color: colors.textMuted, textAlign: "center", padding: 32, fontSize: 13 }}>
      {text}
    </Text>
  );
}

function Centered({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      {children}
    </View>
  );
}

const rowStyle = (colors: Colors) => ({
  flexDirection: "row" as const,
  alignItems: "center" as const,
  paddingHorizontal: 16,
  paddingVertical: 14,
  borderTopWidth: 1,
  borderTopColor: colors.border,
});

const primaryBtn = (colors: Colors) => ({
  backgroundColor: colors.primary,
  borderRadius: 10,
  paddingHorizontal: 20,
  paddingVertical: 10,
} as const);
