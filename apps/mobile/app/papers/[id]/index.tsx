import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { COMMENT_CONTENT_MAX, getPaperDisplayTitle } from "@gongmoa/core";
import {
  deleteComment,
  getComments,
  getRatingSummary,
  isBookmarked,
  postComment,
  postRating,
  setBookmark,
  type RatingSummary,
} from "../../../src/lib/paper-detail";
import { getPaper, hasCbtAnswers } from "../../../src/lib/papers";
import type { Comment, ExamPaper } from "@gongmoa/core";
import { useAuth } from "../../../src/providers/auth-provider";
import { colors } from "../../../src/theme/colors";

export default function PaperDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const paperId = String(id ?? "");
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [paper, setPaper] = useState<ExamPaper | null>(null);
  const [cbt, setCbt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [rating, setRating] = useState<RatingSummary>({ average: null, count: 0, myScore: null });
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!paperId) return;
    // 핵심(문제지·CBT 여부)만 먼저 받아 화면을 그리고, 평점·댓글·북마크는 뒤이어
    // 백그라운드로 채운다 — 초기 페인트가 댓글 로딩을 기다리지 않게.
    Promise.all([getPaper(paperId), hasCbtAnswers(paperId).catch(() => false)])
      .then(([p, c]) => {
        setPaper(p);
        setCbt(c);
      })
      .finally(() => setLoading(false));

    getRatingSummary(paperId)
      .then(setRating)
      .catch(() => {});
    getComments(paperId)
      .then(setComments)
      .catch(() => {});
    if (userId) isBookmarked(paperId).then(setBookmarked).catch(() => {});
  }, [paperId, userId]);

  function requireLogin(): boolean {
    if (userId) return true;
    Alert.alert("로그인 필요", "로그인 후 이용할 수 있어요.", [
      { text: "취소", style: "cancel" },
      { text: "로그인", onPress: () => router.push("/(auth)/login") },
    ]);
    return false;
  }

  async function toggleBookmark() {
    if (!requireLogin()) return;
    const next = !bookmarked;
    setBookmarked(next); // 낙관적
    try {
      await setBookmark(paperId, next);
    } catch {
      setBookmarked(!next);
      Alert.alert("오류", "북마크 변경에 실패했어요.");
    }
  }

  async function rate(score: number) {
    if (!requireLogin()) return;
    try {
      await postRating(paperId, score);
      setRating(await getRatingSummary(paperId));
    } catch (e) {
      Alert.alert("평가", e instanceof Error ? e.message : "평가에 실패했어요.");
    }
  }

  async function submitComment() {
    if (!requireLogin()) return;
    const content = draft.trim();
    if (!content) return;
    setPosting(true);
    try {
      await postComment(paperId, content);
      setDraft("");
      setComments(await getComments(paperId));
    } catch {
      Alert.alert("댓글", "등록에 실패했어요.");
    } finally {
      setPosting(false);
    }
  }

  function removeComment(cid: string) {
    Alert.alert("댓글 삭제", "삭제할까요?", [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteComment(cid);
            setComments((prev) => prev.filter((c) => c.id !== cid));
          } catch {
            Alert.alert("오류", "삭제에 실패했어요.");
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!paper) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.textMuted }}>문제지를 찾을 수 없어요.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: 6 }}>
        <Text style={{ fontSize: 19, fontWeight: "700" }}>
          {getPaperDisplayTitle(paper.title, paper.track)}
        </Text>
        <Text style={{ color: colors.textMuted }}>
          {paper.year}년 {paper.round}회
          {paper.level ? ` · ${paper.level}` : ""}
          {paper.question_count ? ` · ${paper.question_count}문항` : ""}
        </Text>
      </View>

      {/* 액션 */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable onPress={toggleBookmark} style={outlineBtn}>
          <Text style={{ color: bookmarked ? colors.primary : colors.text, fontWeight: "600" }}>
            {bookmarked ? "★ 즐겨찾기" : "☆ 즐겨찾기"}
          </Text>
        </Pressable>
        <Link href={`/papers/${paper.id}/pdf`} asChild>
          <Pressable style={outlineBtn}>
            <Text style={{ fontWeight: "600" }}>원본 PDF</Text>
          </Pressable>
        </Link>
        <Link href={`/papers/${paper.id}/explanations`} asChild>
          <Pressable style={outlineBtn}>
            <Text style={{ fontWeight: "600" }}>해설</Text>
          </Pressable>
        </Link>
      </View>

      {cbt ? (
        <Link href={`/papers/${paper.id}/cbt`} asChild>
          <Pressable style={primaryBtn}>
            <Text style={{ color: colors.primaryText, fontWeight: "600" }}>CBT로 풀기</Text>
          </Pressable>
        </Link>
      ) : (
        <Text style={{ color: colors.textMuted }}>아직 CBT를 지원하지 않는 문제지예요.</Text>
      )}

      {/* 난이도 */}
      <View style={{ gap: 8 }}>
        <Text style={{ fontWeight: "700" }}>
          난이도{" "}
          <Text style={{ color: colors.textMuted, fontWeight: "400" }}>
            {rating.average != null
              ? `평균 ${rating.average.toFixed(1)} · ${rating.count}명`
              : "· 평가 없음"}
          </Text>
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[1, 2, 3, 4, 5].map((s) => (
            <Pressable
              key={s}
              onPress={() => rate(s)}
              disabled={rating.myScore != null}
              style={{
                width: 44,
                height: 40,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: rating.myScore === s ? colors.primary : colors.border,
                backgroundColor: rating.myScore === s ? colors.primary : colors.bg,
                alignItems: "center",
                justifyContent: "center",
                opacity: rating.myScore != null && rating.myScore !== s ? 0.5 : 1,
              }}
            >
              <Text
                style={{
                  color: rating.myScore === s ? colors.primaryText : colors.text,
                  fontWeight: "600",
                }}
              >
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
        {rating.myScore != null && (
          <Text style={{ fontSize: 12, color: colors.textMuted }}>내 평가: {rating.myScore}</Text>
        )}
      </View>

      {/* 댓글 */}
      <View style={{ gap: 10 }}>
        <Text style={{ fontWeight: "700" }}>댓글 ({comments.length})</Text>

        <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="댓글을 남겨보세요"
            placeholderTextColor={colors.textMuted}
            maxLength={COMMENT_CONTENT_MAX}
            multiline
            style={{
              flex: 1,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 8,
              color: colors.text,
              maxHeight: 120,
            }}
          />
          <Pressable
            onPress={submitComment}
            disabled={posting || !draft.trim()}
            style={{
              backgroundColor: posting || !draft.trim() ? colors.border : colors.primary,
              borderRadius: 10,
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: colors.primaryText, fontWeight: "600" }}>등록</Text>
          </Pressable>
        </View>

        {comments.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: 13, paddingVertical: 8 }}>
            아직 댓글이 없어요.
          </Text>
        ) : (
          comments.map((c) => (
            <View
              key={c.id}
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.border,
                paddingVertical: 10,
                gap: 3,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontWeight: "600", fontSize: 13 }}>{c.nickname}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                  {new Date(c.created_at).toLocaleDateString("ko-KR")}
                </Text>
              </View>
              <Text style={{ fontSize: 14 }}>{c.content}</Text>
              {userId && c.user_id === userId && (
                <Pressable onPress={() => removeComment(c.id)} style={{ alignSelf: "flex-start" }}>
                  <Text style={{ color: colors.danger, fontSize: 12 }}>삭제</Text>
                </Pressable>
              )}
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const outlineBtn = {
  flex: 1,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 10,
  paddingVertical: 12,
  alignItems: "center" as const,
};

const primaryBtn = {
  backgroundColor: colors.primary,
  borderRadius: 12,
  paddingVertical: 12,
  alignItems: "center" as const,
};
