import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import { CbtResultModal } from "../../../src/components/cbt-result-modal";
import { OmrPanel } from "../../../src/components/omr-panel";
import { PdfPenViewer } from "../../../src/components/pdf-pen-viewer";
import { SingleQuestionView } from "../../../src/components/single-question-view";
import {
  MIN_ATTEMPT_SECONDS,
  startCbtAttempt,
  submitCbtAttempt,
  type CbtSubmitResult,
} from "../../../src/lib/cbt";
import { formatDuration } from "@gongmoa/core";
import { getCbtQuestionData, getPaper } from "../../../src/lib/papers";
import { publicUrl } from "../../../src/lib/storage";
import { useAuth } from "../../../src/providers/auth-provider";
import { colors } from "../../../src/theme/colors";

// 5초 카운트다운 후 서버에 시작 기록(startCbtAttempt) → 응답의 startedAt 을 기준으로
// 경과시간을 잰다. 웹과 동일하게 클라이언트 시계로 먼저 시작하지 않는다(네트워크
// 지연만큼 서버 기준 3분이 늦게 끝나는 문제 방지). running 이 꺼지면 시간도 멈춘다.
function useCbtTimer(paperId: string, enabled: boolean, running: boolean) {
  const [countdown, setCountdown] = useState(5);
  const [elapsed, setElapsed] = useState(0);
  const [started, setStarted] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const startedAtRef = useRef(0);
  const requestedRef = useRef(false);

  const requestStart = useCallback(() => {
    requestedRef.current = true;
    setStartError(null);
    startCbtAttempt(paperId)
      .then((startedAt) => {
        startedAtRef.current = new Date(startedAt).getTime();
        setStarted(true);
      })
      .catch((e) => {
        requestedRef.current = false;
        setStartError(e instanceof Error ? e.message : "시작 기록에 실패했어요.");
      });
  }, [paperId]);

  useEffect(() => {
    if (!enabled) return;
    if (countdown <= 0) {
      if (!requestedRef.current) requestStart();
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [enabled, countdown, requestStart]);

  useEffect(() => {
    if (!running || !started) return;
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [running, started]);

  const reset = useCallback(() => {
    setCountdown(5);
    setElapsed(0);
    setStarted(false);
    requestedRef.current = false;
  }, []);

  return { countdown, elapsed, started, startError, startedAtRef, requestStart, reset };
}

export default function CbtScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const paperId = String(id ?? "");
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [choiceCount, setChoiceCount] = useState(5);
  const [questionImages, setQuestionImages] = useState<Record<number, string[]>>({});
  const [questionChoiceCounts, setQuestionChoiceCounts] = useState<
    Record<number, number>
  >({});
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  // 전체 PDF / 문제별 보기. 크롭 이미지가 있으면 문제별로 시작, 없으면 전체 PDF.
  const [viewMode, setViewMode] = useState<"single" | "full">("single");

  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [omrOpen, setOmrOpen] = useState(false);
  const [result, setResult] = useState<CbtSubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loggedIn = !!session;
  const timer = useCbtTimer(
    paperId,
    loggedIn && !loading && totalQuestions > 0,
    !result,
  );

  useEffect(() => {
    if (!paperId) return;
    Promise.all([getPaper(paperId), getCbtQuestionData(paperId)])
      .then(([paper, cbt]) => {
        const total = paper?.question_count ?? 0;
        setTotalQuestions(total);
        setChoiceCount(paper?.choice_count ?? 5);
        setQuestionImages(cbt.questionImages);
        setQuestionChoiceCounts(cbt.questionChoiceCounts);
        setAnswers(Array(total).fill(null));
        setFileUrl(paper?.file_path ? publicUrl(paper.file_path) : null);
        // 크롭 이미지가 없으면 전체 PDF 로 시작한다.
        if (Object.keys(cbt.questionImages).length === 0) setViewMode("full");
        // 모든 문항 이미지를 미리 받아둬 다음/이전 이동이 캐시에서 즉시 그려지게 한다
        // (안 하면 이동할 때마다 네트워크 로드로 사진이 늦게 뜬다).
        const urls = Object.values(cbt.questionImages).flat();
        if (urls.length > 0) Image.prefetch(urls);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [paperId]);

  // 세트문제(공통지문 공유): 연속 번호가 완전히 같은 이미지 배열을 가리키면 한 세트로 묶는다.
  const questionGroups = useMemo(() => {
    const groups = new Map<number, number[]>();
    let i = 1;
    while (i <= totalQuestions) {
      const images = questionImages[i] ?? [];
      let end = i;
      if (images.length > 0) {
        while (
          end + 1 <= totalQuestions &&
          questionImages[end + 1]?.length === images.length &&
          questionImages[end + 1]?.every((src, idx) => src === images[idx])
        ) {
          end++;
        }
      }
      const numbers: number[] = [];
      for (let n = i; n <= end; n++) numbers.push(n);
      for (const n of numbers) groups.set(n, numbers);
      i = end + 1;
    }
    return groups;
  }, [questionImages, totalQuestions]);

  const answeredCount = answers.filter((a) => a !== null).length;
  const resultByQuestion = useMemo(
    () =>
      new Map((result?.questionResults ?? []).map((q) => [q.question_number, q])),
    [result],
  );

  function selectChoice(questionIndex: number, choice: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[questionIndex] = next[questionIndex] === choice ? null : choice;
      return next;
    });
  }

  async function handleSubmit() {
    if (submitting) return;
    if (!timer.started) {
      Alert.alert("잠시만요", "시작 기록 확인 중이에요. 잠시 후 다시 시도해주세요.");
      return;
    }
    if (Date.now() - timer.startedAtRef.current < MIN_ATTEMPT_SECONDS * 1000) {
      Alert.alert("조금만 더", "최소 3분은 풀어야 채점할 수 있어요.");
      return;
    }
    const doSubmit = async () => {
      setSubmitting(true);
      try {
        const res = await submitCbtAttempt(paperId, answers);
        setOmrOpen(false);
        setResult(res);
      } catch (e) {
        Alert.alert("채점 실패", e instanceof Error ? e.message : "다시 시도해주세요.");
      } finally {
        setSubmitting(false);
      }
    };

    if (answeredCount < totalQuestions) {
      Alert.alert(
        "채점할까요?",
        `아직 ${totalQuestions - answeredCount}문항을 안 풀었어요.`,
        [
          { text: "취소", style: "cancel" },
          { text: "채점", onPress: doSubmit },
        ],
      );
      return;
    }
    await doSubmit();
  }

  function handleRetry() {
    setAnswers(Array(totalQuestions).fill(null));
    setResult(null);
    setCurrentIndex(0);
    timer.reset();
  }

  // ── 렌더 게이트 ──────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  if (!loggedIn) {
    return (
      <Centered>
        <Text style={{ color: colors.textMuted, marginBottom: 12 }}>
          CBT는 로그인 후 이용할 수 있어요.
        </Text>
        <Pressable onPress={() => router.push("/(auth)/login")} style={primaryBtn}>
          <Text style={{ color: colors.primaryText, fontWeight: "500" }}>로그인</Text>
        </Pressable>
      </Centered>
    );
  }

  const hasImages = Object.keys(questionImages).length > 0;
  // 문제별 이미지도 없고 PDF도 없으면 풀 방법이 없다.
  if (!hasImages && !fileUrl) {
    return (
      <Centered>
        <Text style={{ color: colors.textMuted, textAlign: "center" }}>
          이 문제지는 앱 CBT를 아직 지원하지 않아요.
        </Text>
      </Centered>
    );
  }
  // 이미지가 없으면 전체 PDF 로만 풀 수 있으니 문제별 토글을 막는다.
  const effectiveMode: "single" | "full" = hasImages ? viewMode : "full";

  const groupNumbers = questionGroups.get(currentIndex + 1) ?? [currentIndex + 1];
  const groupFirst = groupNumbers[0];
  const groupLast = groupNumbers[groupNumbers.length - 1];
  const prevIndex =
    groupFirst > 1
      ? (questionGroups.get(groupFirst - 1) ?? [groupFirst - 1])[0] - 1
      : null;
  const nextIndex = groupLast < totalQuestions ? groupLast : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
              {timer.countdown > 0
                ? `${timer.countdown}초 후 시작`
                : timer.startError
                  ? "시작 실패"
                  : timer.started
                    ? formatDuration(timer.elapsed)
                    : "시작 중..."}
            </Text>
          ),
        }}
      />

      {/* 문제별/전체 토글 — 크롭 이미지가 있는 문제지에서만 노출 */}
      {hasImages && fileUrl && (
        <View
          style={{
            flexDirection: "row",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 6,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <ModeTab
            label="문제별"
            active={effectiveMode === "single"}
            onPress={() => setViewMode("single")}
          />
          <ModeTab
            label="전체 PDF"
            active={effectiveMode === "full"}
            onPress={() => setViewMode("full")}
          />
        </View>
      )}

      {effectiveMode === "single" ? (
        <SingleQuestionView
          images={questionImages[currentIndex + 1] ?? []}
          totalQuestions={totalQuestions}
          questions={groupNumbers.map((number) => ({
            number,
            choiceCount: questionChoiceCounts[number] ?? choiceCount,
            selected: answers[number - 1] ?? null,
            onSelect: (choice: number) => selectChoice(number - 1, choice),
            result: result ? (resultByQuestion.get(number) ?? null) : null,
          }))}
          onPrev={() => prevIndex !== null && setCurrentIndex(prevIndex)}
          onNext={() => nextIndex !== null && setCurrentIndex(nextIndex)}
          hasPrev={prevIndex !== null}
          hasNext={nextIndex !== null}
          paperId={paperId}
          showMemo={loggedIn}
        />
      ) : (
        <View style={{ flex: 1 }}>
          {fileUrl && <PdfPenViewer fileUrl={fileUrl} />}
        </View>
      )}

      {/* 하단 액션 바 */}
      <View
        style={{
          flexDirection: "row",
          gap: 10,
          padding: 12,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Pressable
          onPress={() => setOmrOpen(true)}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 10,
            paddingVertical: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "500" }}>
            답안지 ({answeredCount}/{totalQuestions})
          </Text>
        </Pressable>
        {!result && (
          <Pressable
            onPress={handleSubmit}
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
              {submitting ? "채점 중..." : "제출"}
            </Text>
          </Pressable>
        )}
      </View>

      {/* OMR 답안지 (바텀시트) */}
      <Modal
        visible={omrOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setOmrOpen(false)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "rgba(0,0,0,0.4)",
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setOmrOpen(false)} />
          <View
            style={{
              maxHeight: "70%",
              backgroundColor: colors.bg,
              borderTopLeftRadius: 16,
              borderTopRightRadius: 16,
            }}
          >
            <View
              style={{
                padding: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={{ fontWeight: "600" }}>답안지</Text>
            </View>
            <OmrPanel
              totalQuestions={totalQuestions}
              choiceCount={choiceCount}
              answers={answers}
              onSelect={selectChoice}
              resultByQuestion={result ? resultByQuestion : null}
            />
          </View>
        </View>
      </Modal>

      {result && (
        <CbtResultModal
          result={result}
          onRetry={handleRetry}
          onClose={() => router.back()}
        />
      )}
    </View>
  );
}

function ModeTab({
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
        backgroundColor: active ? colors.primary : "transparent",
      }}
    >
      <Text
        style={{
          color: active ? colors.primaryText : colors.textMuted,
          fontWeight: "500",
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
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
