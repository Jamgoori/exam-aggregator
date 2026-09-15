import {
  createImagePreloadQueue,
  formatDuration,
  groupQuestionsBySharedImages,
  MIN_ATTEMPT_SECONDS,
  resolveInitialCbtViewMode,
  type CbtSubmitResponse,
  type CbtViewMode,
} from "@gongmoa/core";
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { useCbtTimer } from "./cbt-timer";
import { DEFAULT_PEN_WIDTH, type DrawTool, type InkStroke } from "./ink-layer";
import { clearCbtDrafts, loadCbtDraft, saveCbtDraft } from "../../lib/cbt-draft";
import { handleEdgeError } from "../../lib/edge";
import { hapticSelect, hapticSuccess } from "../../lib/haptics";
import { useStartCbt, useSubmitCbt } from "../../queries/cbt";
import { PEN_COLORS } from "./drawing-toolbar";

// CBT 솔버의 상태 전부(웹 cbt-solver.tsx 의 상태·핸들러를 훅으로). 렌더는 cbt-solver.tsx.
//
// 답안·필기·결과는 여기(메모리)에만 있고, 드래프트(§6.5)는 답안+정규화 스트로크만 kv 에 둔다.
// 채점 결과(questionResults)는 절대 디스크로 가지 않는다.
export type CbtQuestionResult = CbtSubmitResponse["questionResults"][number];

// 현재 문항 기준 앞뒤로 미리 받아둘 문항 수(설계서 §6.2 "±3, 동시 4"). 웹은 전 문항을 큐에
// 넣지만 앱은 창을 둬 과목 전체 프리페치를 막는다.
const PRELOAD_WINDOW = 3;

// 문항 이미지 미리받기(웹 question-image-preload.ts): 큐는 core, 실제 받기는 expo-image
// prefetch(디스크 캐시). 문항을 넘기면 그 지점 기준으로 창을 다시 매긴다.
function useQuestionImagePreload({
  enabled,
  imagesByItem,
  currentIndex,
}: {
  enabled: boolean;
  imagesByItem: string[][];
  currentIndex: number;
}) {
  const queueRef = useRef<ReturnType<typeof createImagePreloadQueue> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const queue = createImagePreloadQueue({
      start: (target, done) => {
        Image.prefetch(target.src, { cachePolicy: "memory-disk" }).then(
          () => done(),
          () => done(),
        );
      },
    });
    queueRef.current = queue;
    return () => {
      queue.stop();
      queueRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const windowed = imagesByItem.map((imgs, i) =>
      Math.abs(i - currentIndex) <= PRELOAD_WINDOW ? imgs : [],
    );
    queueRef.current?.prioritize(windowed, currentIndex);
  }, [enabled, imagesByItem, currentIndex]);
}

export type UseCbtStateArgs = {
  paperId: string;
  userId: string | null;
  totalQuestions: number;
  questionImages: Record<number, string[]>;
  // 계정에 명시적으로 저장된 시작 모드(user_metadata.default_cbt_view_mode). 없으면 null.
  defaultViewMode: CbtViewMode | null;
};

export function useCbtState({
  paperId,
  userId,
  totalQuestions,
  questionImages,
  defaultViewMode,
}: UseCbtStateArgs) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => Array(totalQuestions).fill(null));
  const [omrOpen, setOmrOpen] = useState(false);
  const [result, setResult] = useState<CbtSubmitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawTool>("move");
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_WIDTH);
  // 자물쇠가 저장해 둔 시작 모드(낙관적 갱신을 위해 부모가 든다 — 웹과 동일).
  const [savedDefaultViewMode, setSavedDefaultViewMode] = useState<CbtViewMode | null>(defaultViewMode);
  const hasQuestionImages = Object.keys(questionImages).length > 0;
  const [viewMode, setViewMode] = useState<CbtViewMode>(() =>
    resolveInitialCbtViewMode(defaultViewMode, hasQuestionImages),
  );
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // 문제별 보기 필기(문항 인덱스 → 획). 전체보기 필기는 Phase 2.
  const [singleStrokes, setSingleStrokes] = useState<Record<number, InkStroke[]>>({});
  // 드래프트 확인이 끝났는지 — 끝나기 전엔 카운트다운을 돌리지 않는다(복원 경합 방지).
  const [restoreChecked, setRestoreChecked] = useState(false);

  const startMutation = useStartCbt(paperId);
  const submitMutation = useSubmitCbt(paperId, userId);

  const start = useCallback(async () => {
    try {
      const res = await startMutation.mutateAsync();
      // 새로 시작했으니 옛 startedAt 의 드래프트는 의미가 없다.
      void clearCbtDrafts(paperId);
      return res;
    } catch (e) {
      const handled = await handleEdgeError(e, { next: `/papers/${paperId}/cbt` });
      throw new Error(handled.message);
    }
    // mutateAsync 는 안정 참조.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  const timer = useCbtTimer({ enabled: restoreChecked && !!userId, running: !result, start });
  const { resume } = timer;

  // 드래프트 복원(§6.5): 서버 시작 행 + 같은 startedAt 의 드래프트가 있을 때만.
  useEffect(() => {
    let alive = true;
    loadCbtDraft(paperId)
      .then((found) => {
        if (!alive) return;
        if (found) {
          const restored = Array(totalQuestions)
            .fill(null)
            .map((_, i) => found.draft.answers[i] ?? null);
          setAnswers(restored);
          setSingleStrokes(found.draft.strokes ?? {});
          resume(found.startedAt);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setRestoreChecked(true);
      });
    return () => {
      alive = false;
    };
  }, [paperId, totalQuestions, resume]);

  // 드래프트 저장(디바운스). 채점 전·시작 후에만.
  const { startedAtIso } = timer;
  useEffect(() => {
    if (!startedAtIso || result) return;
    const t = setTimeout(() => {
      void saveCbtDraft(paperId, startedAtIso, { answers, strokes: singleStrokes });
    }, 400);
    return () => clearTimeout(t);
  }, [paperId, startedAtIso, result, answers, singleStrokes]);

  // 세트문제 묶기(core) — 이전/다음은 세트 단위.
  const questionGroups = useMemo(
    () => groupQuestionsBySharedImages(totalQuestions, questionImages),
    [questionImages, totalQuestions],
  );
  const imagesByQuestionIndex = useMemo(
    () => Array.from({ length: totalQuestions }, (_, i) => questionImages[i + 1] ?? []),
    [questionImages, totalQuestions],
  );
  useQuestionImagePreload({
    enabled: viewMode === "single",
    imagesByItem: imagesByQuestionIndex,
    currentIndex: currentQuestionIndex,
  });

  const currentGroupNumbers = questionGroups.get(currentQuestionIndex + 1) ?? [currentQuestionIndex + 1];
  const groupFirstNumber = currentGroupNumbers[0];
  const groupLastNumber = currentGroupNumbers[currentGroupNumbers.length - 1];
  const prevNumber = groupFirstNumber > 1 ? groupFirstNumber - 1 : null;
  const prevGroupNumbers = prevNumber ? (questionGroups.get(prevNumber) ?? [prevNumber]) : null;
  const prevQuestionIndex = prevGroupNumbers ? prevGroupNumbers[0] - 1 : null;
  const nextQuestionIndex = groupLastNumber < totalQuestions ? groupLastNumber : null;
  const isQuestionSet = groupFirstNumber !== groupLastNumber;

  const answeredCount = answers.filter((a) => a !== null).length;
  const resultByQuestion = useMemo(
    () => new Map((result?.questionResults ?? []).map((q) => [q.question_number, q])),
    [result],
  );

  const selectChoice = useCallback((questionIndex: number, choice: number) => {
    hapticSelect();
    setAnswers((prev) => {
      const next = [...prev];
      next[questionIndex] = next[questionIndex] === choice ? null : choice;
      return next;
    });
  }, []);

  // 필기: 현재 문항의 획 추가 / 현재 문항만 비우기(웹 clearCurrent).
  const appendStroke = useCallback((questionIndex: number, stroke: InkStroke) => {
    setSingleStrokes((prev) => ({ ...prev, [questionIndex]: [...(prev[questionIndex] ?? []), stroke] }));
  }, []);

  const clearDrawing = useCallback(() => {
    if (viewMode === "single") {
      setSingleStrokes((prev) => {
        if (!prev[currentQuestionIndex]) return prev;
        const next = { ...prev };
        delete next[currentQuestionIndex];
        return next;
      });
    }
    // 전체보기 필기는 Phase 2(분할 패널·PdfPenViewer 와 함께).
  }, [viewMode, currentQuestionIndex]);

  // 전체보기(PDF)와 문제별 보기는 서로 다른 캔버스(좌표계)에 필기를 남기므로 오갈 때 경고 후
  // 해당 모드의 스트로크를 지운다(웹 switchViewMode, 문구 동일).
  const switchViewMode = useCallback(
    (mode: CbtViewMode) => {
      if (mode === viewMode) return;
      if (viewMode === "full" && mode === "single") {
        Alert.alert("문제별 보기로 바꾸면 전체보기에 그린 필기 내용이 모두 지워져요. 계속할까요?", undefined, [
          { text: "취소", style: "cancel" },
          { text: "계속", onPress: () => setViewMode("single") },
        ]);
        return;
      }
      if (viewMode === "single" && mode === "full") {
        Alert.alert("전체보기로 바꾸면 문제별 보기에 그린 필기 내용이 모두 지워져요. 계속할까요?", undefined, [
          { text: "취소", style: "cancel" },
          {
            text: "계속",
            onPress: () => {
              setSingleStrokes({});
              // Phase 1a 전체보기는 보기 전용(펜 없음)이라 도구를 이동으로 되돌린다.
              setTool("move");
              setViewMode("full");
            },
          },
        ]);
        return;
      }
      setViewMode(mode);
    },
    [viewMode],
  );

  const submitting = submitMutation.isPending;
  const { started, startedAtMs, startedAtIso: startedIso } = timer;

  const doSubmit = useCallback(async () => {
    if (!startedIso) return;
    setError(null);
    try {
      const res = await submitMutation.mutateAsync({ answers, startedAt: startedIso });
      setOmrOpen(false);
      setResult(res);
      hapticSuccess();
      void clearCbtDrafts(paperId);
    } catch (e) {
      const handled = await handleEdgeError(e, { next: `/papers/${paperId}/cbt` });
      if (handled.redirected) return;
      setError(handled.message);
      // recoverAttempt 까지 실패한 "이미 회수됨" 케이스는 안내창으로도 알린다(§6.6).
      if (handled.message === "다른 기기에서 이미 채점됐어요") Alert.alert(handled.message);
    }
    // mutateAsync 는 안정 참조.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, paperId, startedIso]);

  // 제출 가드 3단(웹 handleSubmit, 문구 동일): 시작 전 → 90초 미만 → 미답.
  const handleSubmit = useCallback(() => {
    if (submitting) return;
    if (!started || startedAtMs === null) {
      Alert.alert("시작 기록 확인 중이에요. 잠시 후 다시 시도해주세요.");
      return;
    }
    // 실제 검증은 서버가 하지만 서버가 기록한 startedAt 기준이라 이 검사가 서버 판정과 일치한다.
    if (Date.now() - startedAtMs < MIN_ATTEMPT_SECONDS * 1000) {
      Alert.alert(`최소 ${formatDuration(MIN_ATTEMPT_SECONDS)}은 풀어야 채점할 수 있어요. 조금만 더 풀어보세요!`);
      return;
    }
    if (answeredCount < totalQuestions) {
      Alert.alert(`아직 ${totalQuestions - answeredCount}문항을 안 풀었어요. 그래도 채점할까요?`, undefined, [
        { text: "취소", style: "cancel" },
        { text: "채점", onPress: () => void doSubmit() },
      ]);
      return;
    }
    void doSubmit();
  }, [submitting, started, startedAtMs, answeredCount, totalQuestions, doSubmit]);

  // "다시 풀기": 답안·결과·필기 초기화 후 카운트다운 5초부터.
  const { reset } = timer;
  const handleRetry = useCallback(() => {
    setAnswers(Array(totalQuestions).fill(null));
    setSingleStrokes({});
    setResult(null);
    setError(null);
    void clearCbtDrafts(paperId);
    reset();
  }, [totalQuestions, paperId, reset]);

  return {
    // 상태
    answers,
    answeredCount,
    result,
    resultByQuestion,
    error,
    submitting,
    tool,
    penColor,
    penWidth,
    viewMode,
    hasQuestionImages,
    savedDefaultViewMode,
    omrOpen,
    currentQuestionIndex,
    currentGroupNumbers,
    groupFirstNumber,
    groupLastNumber,
    isQuestionSet,
    prevQuestionIndex,
    nextQuestionIndex,
    singleStrokes,
    timer,
    // 핸들러
    setTool,
    setPenColor,
    setPenWidth,
    setSavedDefaultViewMode,
    setOmrOpen,
    setCurrentQuestionIndex,
    selectChoice,
    appendStroke,
    clearDrawing,
    switchViewMode,
    handleSubmit,
    handleRetry,
  };
}
