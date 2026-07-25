import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useFocusEffect } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import type { WrongNoteSubjectGroup } from "@gongmoa/core";
import { ImageZoomModal } from "../../../src/components/image-zoom-modal";
import { WrongNoteQuestionCard } from "../../../src/components/wrong-note-question-card";
import {
  fetchQuestionImages,
  fetchWrongNoteMarks,
  getWrongNoteGroupsCached,
  setQuestionDeleted,
  setQuestionPinned,
} from "../../../src/lib/wrong-notes";
import { useColors } from "../../../src/theme/colors";

type View2 = "papers" | "questions";

// 과목 오답노트. 웹 mypage/wrong-notes/[slug] 와 같은 구조 — 문제지별/문항별 두 보기.
// 집계는 @gongmoa/core 의 buildWrongNoteGroups 라 웹과 숫자가 같다.
export default function SubjectWrongNoteScreen() {
  const colors = useColors();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();

  const [group, setGroup] = useState<WrongNoteSubjectGroup | null>(null);
  const [images, setImages] = useState<Map<string, string[]>>(new Map());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View2>("papers");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [zoomUri, setZoomUri] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!slug) return;
    const { groups } = await getWrongNoteGroupsCached();
    const found = groups.find((g) => g.subject.slug === String(slug)) ?? null;
    setGroup(found);
    if (found) {
      const paperIds = found.papers.map((p) => p.paper.id);
      const [imgs, marks] = await Promise.all([
        fetchQuestionImages(paperIds),
        fetchWrongNoteMarks(paperIds),
      ]);
      setImages(imgs);
      setPinned(marks.pinned);
    }
  }, [slug]);

  // CBT·섞어풀기를 하고 돌아오면 극복 여부가 달라지므로 들어올 때마다 새로고침한다.
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

  // 문항 모아보기: 문제지 구분 없이 한 줄로 편다. 미극복 먼저, 그다음 많이 틀린 순.
  const flatQuestions = useMemo(() => {
    if (!group) return [];
    return group.papers
      .flatMap((p) =>
        p.questions.map((q) => ({ paperId: p.paper.id, paperTitle: p.paper.title, q })),
      )
      .sort(
        (a, b) =>
          Number(a.q.resolved) - Number(b.q.resolved) || b.q.wrongCount - a.q.wrongCount,
      );
  }, [group]);

  async function runMark(
    paperId: string,
    questionNumber: number,
    action: () => Promise<void>,
  ) {
    const key = `${paperId}#${questionNumber}`;
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

  function togglePin(paperId: string, questionNumber: number) {
    const key = `${paperId}#${questionNumber}`;
    return runMark(paperId, questionNumber, () =>
      setQuestionPinned(paperId, questionNumber, !pinned.has(key)),
    );
  }

  function confirmDelete(paperId: string, questionNumber: number) {
    Alert.alert(
      "오답노트에서 빼기",
      `${questionNumber}번을 오답노트에서 뺄까요? 응시 기록과 점수는 그대로 남고, 오답노트·섞어풀기에서만 빠져요.`,
      [
        { text: "취소", style: "cancel" },
        {
          text: "빼기",
          style: "destructive",
          onPress: () =>
            runMark(paperId, questionNumber, () =>
              setQuestionDeleted(paperId, questionNumber, true),
            ),
        },
      ],
    );
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
          이 과목엔 모인 오답이 없어요.
        </Text>
      </Center>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: group.subject.name }} />

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>
        <View style={{ flexDirection: "row", gap: 16 }}>
          <Text style={{ color: colors.danger, fontWeight: "700" }}>
            남은 오답 {group.unresolvedCount}
          </Text>
          <Text style={{ color: colors.success, fontWeight: "700" }}>
            극복 {group.resolvedCount}
          </Text>
        </View>

        <View style={{ flexDirection: "row", gap: 6 }}>
          <Tab label="문제지별" active={view === "papers"} onPress={() => setView("papers")} />
          <Tab
            label="문항별"
            active={view === "questions"}
            onPress={() => setView("questions")}
          />
        </View>

        {view === "papers"
          ? group.papers.map((p) => (
              <Pressable
                key={p.paper.id}
                onPress={() => router.push(`/wrong-notes/${slug}/${p.paper.id}`)}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  padding: 14,
                  backgroundColor: colors.card,
                  gap: 4,
                }}
              >
                <Text style={{ fontWeight: "600" }} numberOfLines={2}>
                  {p.paper.title}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                  {p.attemptCount}회 응시 ·{" "}
                  {new Date(p.lastAttemptAt).toLocaleDateString("ko-KR")}
                  {p.latestScore != null && p.latestTotal != null
                    ? ` · 최근 ${p.latestScore}/${p.latestTotal}`
                    : ""}
                </Text>
                <Text style={{ fontSize: 12 }}>
                  <Text style={{ color: colors.danger, fontWeight: "600" }}>
                    남은 오답 {p.unresolvedCount}
                  </Text>
                  <Text style={{ color: colors.textMuted }}> · 극복 {p.resolvedCount}</Text>
                </Text>
              </Pressable>
            ))
          : flatQuestions.map(({ paperId, paperTitle, q }) => (
              <WrongNoteQuestionCard
                key={`${paperId}#${q.questionNumber}`}
                question={q}
                paperLabel={paperTitle}
                images={images.get(`${paperId}#${q.questionNumber}`) ?? []}
                pinned={pinned.has(`${paperId}#${q.questionNumber}`)}
                busy={busyKey === `${paperId}#${q.questionNumber}`}
                onZoom={setZoomUri}
                onTogglePin={() => togglePin(paperId, q.questionNumber)}
                onDelete={() => confirmDelete(paperId, q.questionNumber)}
              />
            ))}
      </ScrollView>

      <ImageZoomModal uri={zoomUri} onClose={() => setZoomUri(null)} />
    </View>
  );
}

function Tab({
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

function Center({ children }: { children: ReactNode }) {
  return (
    <View
      style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      {children}
    </View>
  );
}
