import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
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
  getWrongNoteDetail,
  type WrongNoteDetail,
} from "../../src/lib/mypage";
import { colors } from "../../src/theme/colors";

// 오답노트 상세: 과목 → 문제지별 틀린 문항 이미지 + 극복 여부 + 다시 풀기.
// 정답은 표시하지 않는다(RLS 차단·커닝 방지) — 극복은 CBT 로 다시 풀 때 서버가 판정한다.
export default function WrongNoteDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<WrongNoteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoomUri, setZoomUri] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    getWrongNoteDetail(slug)
      .then(setDetail)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <Center>
        <ActivityIndicator />
      </Center>
    );
  }

  if (!detail) {
    return (
      <Center>
        <Text style={{ color: colors.textMuted }}>과목을 찾을 수 없어요.</Text>
      </Center>
    );
  }

  const totalWrong = detail.groups.reduce((s, g) => s + g.questions.length, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: detail.subjectName }} />

      {detail.groups.length === 0 ? (
        <Center>
          <Text style={{ color: colors.textMuted, textAlign: "center" }}>
            이 과목엔 모인 오답이 없어요.
          </Text>
        </Center>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 32 }}>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>
            틀린 문항 {totalWrong}개
          </Text>

          {detail.groups.map((g) => (
            <View key={g.paperId} style={{ gap: 10 }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <Text style={{ fontWeight: "700", flex: 1 }} numberOfLines={1}>
                  {g.title}
                </Text>
                <Pressable
                  onPress={() => router.push(`/papers/${g.paperId}/cbt`)}
                  style={{
                    backgroundColor: colors.primary,
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ color: colors.primaryText, fontSize: 12, fontWeight: "600" }}>
                    다시 풀기
                  </Text>
                </Pressable>
              </View>

              {g.questions.map((q) => (
                <View
                  key={q.questionNumber}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 12,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                    }}
                  >
                    <Text style={{ fontWeight: "600" }}>{q.questionNumber}번</Text>
                    <Text
                      style={{
                        fontSize: 11,
                        fontWeight: "600",
                        color: q.resolved ? "#16a34a" : colors.danger,
                      }}
                    >
                      {q.resolved ? "극복" : "미극복"}
                    </Text>
                  </View>
                  {q.images.length === 0 ? (
                    <Text
                      style={{
                        color: colors.textMuted,
                        fontSize: 12,
                        padding: 12,
                        paddingTop: 0,
                      }}
                    >
                      문항 이미지가 없어요.
                    </Text>
                  ) : (
                    q.images.map((uri) => (
                      <Pressable key={uri} onPress={() => setZoomUri(uri)}>
                        <Image
                          source={{ uri }}
                          style={{ width: "100%", aspectRatio: 0.75 }}
                          contentFit="contain"
                          transition={100}
                        />
                      </Pressable>
                    ))
                  )}
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {/* 이미지 확대 */}
      <ZoomModal uri={zoomUri} onClose={() => setZoomUri(null)} />
    </View>
  );
}

function ZoomModal({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(5, Math.max(1, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
    });
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Modal visible={!!uri} transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)" }}>
        <Pressable
          onPress={onClose}
          style={{ position: "absolute", top: 48, right: 20, zIndex: 2 }}
        >
          <Text style={{ color: "#fff", fontSize: 16 }}>닫기</Text>
        </Pressable>
        {uri && (
          <GestureDetector gesture={pinch}>
            <Animated.View style={[{ flex: 1 }, style]}>
              <Image
                source={{ uri }}
                style={{ flex: 1 }}
                contentFit="contain"
                transition={100}
              />
            </Animated.View>
          </GestureDetector>
        )}
      </View>
    </Modal>
  );
}

function Center({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {children}
    </View>
  );
}
