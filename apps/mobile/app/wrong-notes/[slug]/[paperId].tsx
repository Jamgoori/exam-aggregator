import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { WrongNotePaperGroup } from "@gongmoa/core";
import { ImageZoomModal } from "../../../src/components/image-zoom-modal";
import { WrongNoteQuestionCard } from "../../../src/components/wrong-note-question-card";
import {
  fetchQuestionImages,
  fetchWrongNoteMarks,
  getWrongNoteGroups,
  setQuestionDeleted,
  setQuestionPinned,
} from "../../../src/lib/wrong-notes";
import { colors } from "../../../src/theme/colors";

// 문제지별 오답노트. 웹 mypage/wrong-notes/[slug]/[paperId] 대응.
export default function PaperWrongNoteScreen() {
  const { slug, paperId } = useLocalSearchParams<{ slug: string; paperId: string }>();
  const router = useRouter();

  const [group, setGroup] = useState<WrongNotePaperGroup | null>(null);
  const [images, setImages] = useState<Map<string, string[]>>(new Map());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [zoomUri, setZoomUri] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug || !paperId) return;
    const groups = await getWrongNoteGroups();
    const subject = groups.find((g) => g.subject.slug === String(slug));
    const found = subject?.papers.find((p) => p.paper.id === String(paperId)) ?? null;
    setGroup(found);
    if (found) {
      const [imgs, marks] = await Promise.all([
        fetchQuestionImages([found.paper.id]),
        fetchWrongNoteMarks([found.paper.id]),
      ]);
      setImages(imgs);
      setPinned(marks.pinned);
    }
  }, [slug, paperId]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setLoading(true);
      load()
        .catch(() => {})
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
      };
    }, [load]),
  );

  async function runMark(questionNumber: number, action: () => Promise<void>) {
    if (!group) return;
    const key = `${group.paper.id}#${questionNumber}`;
    try {
      setBusyKey(key);
      await action();
      await load();
    } catch (e) {
      Alert.alert("실패", e instanceof Error ? e.message : "다시 시도해 주세요.");
    } finally {
      setBusyKey(null);
    }
  }

  if (loading && !group) {
    return (
      <Center>
        <Stack.Screen options={{ headerShown: true, title: "오답노트" }} />
        <ActivityIndicator />
      </Center>
    );
  }

  if (!group) {
    return (
      <Center>
        <Stack.Screen options={{ headerShown: true, title: "오답노트" }} />
        <Text style={{ color: colors.textMuted, textAlign: "center" }}>
          이 문제지엔 남은 오답이 없어요.
        </Text>
      </Center>
    );
  }

  const paper = group.paper;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: paper.subjects?.name ?? "오답노트" }} />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 17, fontWeight: "700" }}>{paper.title}</Text>
          <Text style={{ color: colors.textMuted, fontSize: 12 }}>
            {group.attemptCount}회 응시 ·{" "}
            {new Date(group.lastAttemptAt).toLocaleDateString("ko-KR")}
            {group.latestScore != null && group.latestTotal != null
              ? ` · 최근 ${group.latestScore}/${group.latestTotal}`
              : ""}
          </Text>
          <Text style={{ fontSize: 12 }}>
            <Text style={{ color: colors.danger, fontWeight: "600" }}>
              남은 오답 {group.unresolvedCount}
            </Text>
            <Text style={{ color: colors.textMuted }}> · 극복 {group.resolvedCount}</Text>
          </Text>
        </View>

        <Pressable
          onPress={() => router.push(`/papers/${paper.id}/cbt`)}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 10,
            paddingVertical: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ color: colors.primaryText, fontWeight: "600" }}>
            이 문제지 다시 풀기
          </Text>
        </Pressable>

        {group.questions.map((q) => (
          <WrongNoteQuestionCard
            key={q.questionNumber}
            question={q}
            images={images.get(`${paper.id}#${q.questionNumber}`) ?? []}
            pinned={pinned.has(`${paper.id}#${q.questionNumber}`)}
            busy={busyKey === `${paper.id}#${q.questionNumber}`}
            onZoom={setZoomUri}
            onTogglePin={() =>
              runMark(q.questionNumber, () =>
                setQuestionPinned(
                  paper.id,
                  q.questionNumber,
                  !pinned.has(`${paper.id}#${q.questionNumber}`),
                ),
              )
            }
            onDelete={() =>
              Alert.alert(
                "오답노트에서 빼기",
                `${q.questionNumber}번을 오답노트에서 뺄까요? 응시 기록과 점수는 그대로 남고, 오답노트·섞어풀기에서만 빠져요.`,
                [
                  { text: "취소", style: "cancel" },
                  {
                    text: "빼기",
                    style: "destructive",
                    onPress: () =>
                      runMark(q.questionNumber, () =>
                        setQuestionDeleted(paper.id, q.questionNumber, true),
                      ),
                  },
                ],
              )
            }
          />
        ))}
      </ScrollView>

      <ImageZoomModal uri={zoomUri} onClose={() => setZoomUri(null)} />
    </View>
  );
}

function Center({ children }: { children: ReactNode }) {
  return (
    <View
      style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      {children}
    </View>
  );
}
