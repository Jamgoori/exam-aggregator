import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import {
  createReview,
  submitReview,
  type ReviewResult,
  type ReviewSession,
} from "../src/lib/review";
import { colors } from "../src/theme/colors";

type Phase = "loading" | "solving" | "submitting" | "result" | "error";

export default function ReviewScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<ReviewResult | null>(null);

  useEffect(() => {
    createReview(true)
      .then((s) => {
        setSession({ ...s, items: s.items ?? [] });
        setAnswers(Array(s.total).fill(null));
        setPhase("solving");
        // 문항 이동이 즉시 그려지도록 모든 이미지를 미리 받아둔다.
        const urls = (s.items ?? []).flatMap((it) => it.images ?? []);
        if (urls.length > 0) Image.prefetch(urls);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "세션 생성 실패");
        setPhase("error");
      });
  }, []);

  async function handleSubmit() {
    if (!session) return;
    setPhase("submitting");
    try {
      const r = await submitReview(session.sessionId, answers);
      setResult(r);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "채점 실패");
      setPhase("error");
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: "섞어풀기" }} />

      {phase === "loading" && (
        <Center>
          <ActivityIndicator />
          <Text style={{ color: colors.textMuted, marginTop: 10 }}>오답을 모으는 중...</Text>
        </Center>
      )}

      {phase === "error" && (
        <Center>
          <Text style={{ color: colors.textMuted, textAlign: "center", marginBottom: 16 }}>
            {error}
          </Text>
          <Pressable onPress={() => router.back()} style={primaryBtn}>
            <Text style={{ color: colors.primaryText, fontWeight: "500" }}>돌아가기</Text>
          </Pressable>
        </Center>
      )}

      {(phase === "solving" || phase === "submitting") && session && (
        <Solver
          session={session}
          index={index}
          answers={answers}
          onSelect={(choice) =>
            setAnswers((prev) => {
              const next = [...prev];
              next[index] = next[index] === choice ? null : choice;
              return next;
            })
          }
          onPrev={() => setIndex((i) => Math.max(0, i - 1))}
          onNext={() => setIndex((i) => Math.min(session.total - 1, i + 1))}
          onSubmit={handleSubmit}
          submitting={phase === "submitting"}
          answeredCount={answers.filter((a) => a !== null).length}
        />
      )}

      {phase === "result" && result && <Result result={result} onClose={() => router.back()} />}
    </View>
  );
}

function Solver({
  session,
  index,
  answers,
  onSelect,
  onPrev,
  onNext,
  onSubmit,
  submitting,
  answeredCount,
}: {
  session: ReviewSession;
  index: number;
  answers: (number | null)[];
  onSelect: (choice: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onSubmit: () => void;
  submitting: boolean;
  answeredCount: number;
}) {
  // total 과 items 길이가 어긋난 응답(서버 오류·부분 응답)에도 렌더가 죽지 않게.
  const item = session.items[index] ?? { position: index, images: [], choiceCount: 0 };
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(4, Math.max(1, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
    });
  const imgStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const isLast = index === session.total - 1;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Text style={{ fontWeight: "700" }}>
          {index + 1}
          <Text style={{ color: colors.textMuted, fontWeight: "400" }}> / {session.total}</Text>
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <GestureDetector gesture={pinch}>
          <Animated.View style={[{ padding: 8 }, imgStyle]}>
            {(item.images ?? []).map((uri) => (
              <Image
                key={uri}
                source={{ uri }}
                style={{ width: "100%", aspectRatio: 0.72 }}
                contentFit="contain"
                transition={100}
              />
            ))}
          </Animated.View>
        </GestureDetector>

        <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingTop: 8 }}>
          {Array.from({ length: item.choiceCount }, (_, c) => {
            const choice = c + 1;
            const selected = answers[index] === choice;
            return (
              <Pressable
                key={choice}
                onPress={() => onSelect(choice)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.primary : colors.bg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: selected ? colors.primaryText : colors.text, fontSize: 16 }}>
                  {choice}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View
        style={{
          flexDirection: "row",
          gap: 10,
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <NavBtn label="이전" onPress={onPrev} disabled={index === 0} />
        {isLast ? (
          <Pressable
            onPress={onSubmit}
            disabled={submitting}
            style={{
              flex: 1,
              backgroundColor: submitting ? colors.border : colors.primary,
              borderRadius: 10,
              paddingVertical: 12,
              alignItems: "center",
            }}
          >
            <Text style={{ color: colors.primaryText, fontWeight: "600" }}>
              {submitting ? "채점 중..." : `제출 (${answeredCount}/${session.total})`}
            </Text>
          </Pressable>
        ) : (
          <NavBtn label="다음" onPress={onNext} disabled={false} primary />
        )}
      </View>
    </View>
  );
}

function Result({ result, onClose }: { result: ReviewResult; onClose: () => void }) {
  const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }}>
      <View style={{ alignItems: "center", gap: 4, paddingVertical: 12 }}>
        <Text style={{ fontSize: 16, color: colors.textMuted }}>섞어풀기 결과</Text>
        <Text style={{ fontSize: 36, fontWeight: "800", color: colors.primary }}>
          {result.score}
          <Text style={{ fontSize: 18, color: colors.textMuted }}> / {result.total}</Text>
        </Text>
        <Text style={{ color: colors.textMuted }}>정답률 {pct}%</Text>
      </View>

      {(result.items ?? []).map((it) => (
        <View
          key={it.position}
          style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: "hidden" }}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              padding: 10,
            }}
          >
            <Text style={{ fontSize: 12, color: colors.textMuted }} numberOfLines={1}>
              {it.paperTitle ?? ""} {it.questionNumber ? `· ${it.questionNumber}번` : ""}
            </Text>
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                color: it.isCorrect ? "#16a34a" : colors.danger,
              }}
            >
              {it.isCorrect ? "정답" : "오답"}
            </Text>
          </View>
          {it.images.map((uri) => (
            <Image
              key={uri}
              source={{ uri }}
              style={{ width: "100%", aspectRatio: 0.75 }}
              contentFit="contain"
            />
          ))}
          <View style={{ padding: 10 }}>
            <Text style={{ fontSize: 13, color: colors.textMuted }}>
              내 답: {it.selectedChoice ?? "-"} · 정답: {it.correctChoice ?? "-"}
            </Text>
          </View>
        </View>
      ))}

      <Pressable
        onPress={onClose}
        style={{ backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: "center" }}
      >
        <Text style={{ color: colors.primaryText, fontWeight: "600" }}>확인</Text>
      </Pressable>
    </ScrollView>
  );
}

function NavBtn({
  label,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        flex: 1,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
        backgroundColor: primary ? colors.primary : "transparent",
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ fontWeight: "500", color: primary ? colors.primaryText : colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Center({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {children}
    </View>
  );
}

const primaryBtn = {
  backgroundColor: colors.primary,
  borderRadius: 10,
  paddingHorizontal: 20,
  paddingVertical: 10,
} as const;
