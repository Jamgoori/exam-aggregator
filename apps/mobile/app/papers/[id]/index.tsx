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
  updateComment,
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
import { useColors, type Colors } from "../../../src/theme/colors";

export default function PaperDetailScreen() {
  const colors = useColors();
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
  // 답글/수정은 한 번에 하나만 열린다(모바일 화면에 폼이 여러 개 열리면 헷갈린다).
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

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

  async function submitReply(parentId: string) {
    if (!requireLogin()) return;
    const content = replyDraft.trim();
    if (!content) return;
    setPosting(true);
    try {
      await postComment(paperId, content, parentId);
      setReplyDraft("");
      setReplyTo(null);
      setComments(await getComments(paperId));
    } catch (e) {
      Alert.alert("답글", e instanceof Error ? e.message : "등록에 실패했어요.");
    } finally {
      setPosting(false);
    }
  }

  async function saveEdit(cid: string) {
    const content = editDraft.trim();
    if (!content) return;
    setPosting(true);
    try {
      await updateComment(cid, content);
      setEditingId(null);
      setEditDraft("");
      setComments(await getComments(paperId));
    } catch (e) {
      Alert.alert("수정", e instanceof Error ? e.message : "수정에 실패했어요.");
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
        <Pressable onPress={toggleBookmark} style={outlineBtn(colors)}>
          <Text style={{ color: bookmarked ? colors.primary : colors.text, fontWeight: "600" }}>
            {bookmarked ? "★ 즐겨찾기" : "☆ 즐겨찾기"}
          </Text>
        </Pressable>
        <Link href={`/papers/${paper.id}/pdf`} asChild>
          <Pressable style={outlineBtn(colors)}>
            <Text style={{ fontWeight: "600" }}>원본 PDF</Text>
          </Pressable>
        </Link>
        <Link href={`/papers/${paper.id}/explanations`} asChild>
          <Pressable style={outlineBtn(colors)}>
            <Text style={{ fontWeight: "600" }}>해설</Text>
          </Pressable>
        </Link>
      </View>

      {cbt ? (
        <Link href={`/papers/${paper.id}/cbt`} asChild>
          <Pressable style={primaryBtn(colors)}>
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
          // 1단계 깊이만 있으므로(대댓글의 대댓글 금지) 최상위를 돌면서 답글을 붙인다.
          comments
            .filter((c) => !c.parent_id)
            .map((c) => {
              const replies = comments.filter((r) => r.parent_id === c.id);
              return (
                <View
                  key={c.id}
                  style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10 }}
                >
                  <CommentBody
                    comment={c}
                    mine={!!userId && c.user_id === userId}
                    editing={editingId === c.id}
                    editDraft={editDraft}
                    busy={posting}
                    onChangeEdit={setEditDraft}
                    onStartEdit={() => {
                      setEditingId(c.id);
                      setEditDraft(c.content);
                    }}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={() => saveEdit(c.id)}
                    onDelete={() => removeComment(c.id)}
                    onReply={() => {
                      if (!requireLogin()) return;
                      setReplyTo(replyTo === c.id ? null : c.id);
                      setReplyDraft("");
                    }}
                  />

                  {replies.map((r) => (
                    <View
                      key={r.id}
                      style={{
                        marginTop: 8,
                        marginLeft: 16,
                        paddingLeft: 10,
                        borderLeftWidth: 2,
                        borderLeftColor: colors.border,
                      }}
                    >
                      <CommentBody
                        comment={r}
                        mine={!!userId && r.user_id === userId}
                        editing={editingId === r.id}
                        editDraft={editDraft}
                        busy={posting}
                        onChangeEdit={setEditDraft}
                        onStartEdit={() => {
                          setEditingId(r.id);
                          setEditDraft(r.content);
                        }}
                        onCancelEdit={() => setEditingId(null)}
                        onSaveEdit={() => saveEdit(r.id)}
                        onDelete={() => removeComment(r.id)}
                      />
                    </View>
                  ))}

                  {replyTo === c.id && (
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 8,
                        alignItems: "flex-end",
                        marginTop: 8,
                        marginLeft: 16,
                      }}
                    >
                      <TextInput
                        value={replyDraft}
                        onChangeText={setReplyDraft}
                        placeholder="답글 달기"
                        placeholderTextColor={colors.textMuted}
                        maxLength={COMMENT_CONTENT_MAX}
                        multiline
                        autoFocus
                        style={{
                          flex: 1,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 10,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          color: colors.text,
                          maxHeight: 100,
                        }}
                      />
                      <Pressable
                        onPress={() => submitReply(c.id)}
                        disabled={posting || !replyDraft.trim()}
                        style={{
                          backgroundColor:
                            posting || !replyDraft.trim() ? colors.border : colors.primary,
                          borderRadius: 10,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                        }}
                      >
                        <Text style={{ color: colors.primaryText, fontWeight: "600" }}>등록</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              );
            })
        )}
      </View>
    </ScrollView>
  );
}

const outlineBtn = (colors: Colors) => ({
  flex: 1,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 10,
  paddingVertical: 12,
  alignItems: "center" as const,
});

const primaryBtn = (colors: Colors) => ({
  backgroundColor: colors.primary,
  borderRadius: 12,
  paddingVertical: 12,
  alignItems: "center" as const,
});

// 댓글 한 줄(최상위·답글 공용). 수정 중이면 입력창으로 바뀐다.
function CommentBody({
  comment,
  mine,
  editing,
  editDraft,
  busy,
  onChangeEdit,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onReply,
}: {
  comment: Comment;
  mine: boolean;
  editing: boolean;
  editDraft: string;
  busy: boolean;
  onChangeEdit: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  // 답글은 최상위 댓글에만 달 수 있어(대댓글의 대댓글 금지) 답글 행에는 안 넘긴다.
  onReply?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontWeight: "600", fontSize: 13 }}>{comment.nickname}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>
          {new Date(comment.created_at).toLocaleDateString("ko-KR")}
          {comment.updated_at ? " (수정됨)" : ""}
        </Text>
      </View>

      {editing ? (
        <View style={{ gap: 6 }}>
          <TextInput
            value={editDraft}
            onChangeText={onChangeEdit}
            maxLength={COMMENT_CONTENT_MAX}
            multiline
            autoFocus
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 8,
              color: colors.text,
              maxHeight: 120,
            }}
          />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable onPress={onSaveEdit} disabled={busy || !editDraft.trim()}>
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>저장</Text>
            </Pressable>
            <Pressable onPress={onCancelEdit} disabled={busy}>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>취소</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text style={{ fontSize: 14 }}>{comment.content}</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            {onReply && (
              <Pressable onPress={onReply}>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>답글</Text>
              </Pressable>
            )}
            {mine && (
              <>
                <Pressable onPress={onStartEdit}>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>수정</Text>
                </Pressable>
                <Pressable onPress={onDelete}>
                  <Text style={{ color: colors.danger, fontSize: 12 }}>삭제</Text>
                </Pressable>
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}
