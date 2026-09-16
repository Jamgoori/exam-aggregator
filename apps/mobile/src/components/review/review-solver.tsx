import { router, type Href } from "expo-router";
import { Check, ChevronLeft, Eraser, Hand, PenLine } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { DrawingToolbar, PEN_COLORS } from "../cbt/drawing-toolbar";
import { useExitGuard } from "../cbt/exit-guard";
import { DEFAULT_PEN_WIDTH, type DrawTool, type InkStroke } from "../cbt/ink-layer";
import { SingleQuestionView, useContentZoom } from "../cbt/single-question-view";
import { themedIcon } from "../../theme/icons";
import { handleEdgeError } from "../../lib/edge";
import { hapticSelect, hapticSuccess } from "../../lib/haptics";
import { clearReviewDraft, loadReviewDraft, saveReviewDraft } from "../../lib/review-draft";
import { useSubmitReview, type ReviewSessionDetail } from "../../queries/review";

// 복습·섞어풀기 풀이 화면(웹 review-solver.tsx 의 풀이 뷰 1:1, 설계서 §4.5 #23).
//
// CBT 와 다른 점: **카운트다운도 최소 응시시간도 없다.** 문제지 경계 없이 섞인 오답을
// 순서대로 풀고 채점할 뿐이라 서버에 시작 시각을 기록하지 않는다(cbt-start 없음). 풀이 중에는
// 출처(문제지·번호)와 정답을 숨기고(서버가 채점 전 세션에 아예 안 싣는다) 채점 후에만 공개한다.
//
// 문제를 다루는 조작(필기 캔버스·쓸어넘김·핀치·화면 높이에 맞춘 문제 폭)은 CBT 문제별 풀기와
// **같은 컴포넌트**(SingleQuestionView)를 쓴다 — 복사본을 만들지 않는다. 배율 버튼은 웹에서도
// lg 전용이라 폰에는 없다(두 손가락 핀치).
const BackIcon = themedIcon(ChevronLeft);
const HandIcon = themedIcon(Hand);
const PenIcon = themedIcon(PenLine);
const EraserIcon = themedIcon(Eraser);
const CheckIcon = themedIcon(Check);

// 웹 confirmLeave 문구 그대로 — "사라진다"가 아니라 "이어서 풀 수 있다"(드래프트가 있으므로).
const LEAVE_MESSAGE = "아직 채점 전이에요. 이 주소로 돌아오면 이어서 풀 수 있어요. 나갈까요?";
const IMAGE_CAPTION = "출처와 정답은 채점 후에 공개돼요.";
// 이미지가 없을 때 문구(웹 review-solver.tsx — CBT 문제별 풀기와 문장이 다르다).
const NO_IMAGE_TEXT = "이 문제의 이미지가 없어요.";
// 문항이 바뀌지 않았는데 매 렌더 새 배열을 주면 이미지 비율 실측이 버려진다(CBT 와 같은 이유).
const EMPTY_IMAGES: string[] = [];

function ToolButton({
  tool,
  active,
  label,
  onPress,
  children,
}: {
  tool: DrawTool;
  active: boolean;
  label: string;
  onPress: (tool: DrawTool) => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={() => onPress(tool)}
      className={[
        "items-center justify-center rounded-md p-1.5",
        active ? "bg-blue-600" : "active:bg-zinc-200 dark:active:bg-zinc-700",
      ].join(" ")}
    >
      {children}
    </Pressable>
  );
}

export function ReviewSolver({
  view,
  backHref,
  subjectSlug,
  userId,
}: {
  // 채점 전 세션(review-history includeUnsubmitted). 채점이 끝나면 라우트가 ReviewResult 로 바꾼다.
  view: ReviewSessionDetail;
  backHref: string;
  subjectSlug: string;
  userId: string | null;
}) {
  const sessionId = view.sessionId;
  const total = view.total;
  const items = view.items;

  const [answers, setAnswers] = useState<(number | null)[]>(() => Array<number | null>(total).fill(null));
  // 드래프트를 읽기 전에는 저장하지 않는다(빈 배열로 덮어쓰지 않으려고).
  const [restored, setRestored] = useState(false);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [tool, setTool] = useState<DrawTool>("move");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_WIDTH);
  // 문항별 필기(인덱스 → 획). 앞뒤로 오가도, 확대·축소해도 남는다(웹 useQuestionDrawing).
  const [strokes, setStrokes] = useState<Record<number, InkStroke[]>>({});
  const { zoom, handlePinchZoom } = useContentZoom();
  const submit = useSubmitReview(sessionId, userId);

  const item = items[index];
  const answeredCount = answers.filter((a) => a !== null).length;
  const isLast = index >= items.length - 1;
  const dirty = answeredCount > 0;
  const pending = submit.isPending;

  // 기기에 담아둔 답을 되살린다(웹은 동기 localStorage, 여기는 kv 라 마운트 후 한 번).
  useEffect(() => {
    let alive = true;
    loadReviewDraft(sessionId, total).then((saved) => {
      if (!alive) return;
      if (saved.some((v) => v !== null)) {
        // 읽는 사이에 사용자가 이미 고른 게 있으면 그쪽이 최신이다.
        setAnswers((prev) => (prev.every((v) => v === null) ? saved : prev));
      }
      setRestored(true);
    });
    return () => {
      alive = false;
    };
  }, [sessionId, total]);

  // 고른 답이 바뀔 때마다 담아둔다. 앱이 백그라운드에서 죽어도 같은 주소로 돌아오면 이어서 푼다.
  useEffect(() => {
    if (!restored) return;
    void saveReviewDraft(sessionId, answers);
  }, [answers, restored, sessionId]);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(backHref as Href);
  }, [backHref]);
  // 답을 하나라도 골랐을 때만 붙잡는다(웹 dirty = 미제출 & 답 1개 이상).
  const confirmLeave = useExitGuard(dirty, leave, LEAVE_MESSAGE);

  const select = useCallback(
    (choice: number) => {
      if (!item) return;
      hapticSelect();
      setAnswers((prev) => {
        const next = [...prev];
        // 같은 번호를 다시 누르면 선택 해제(웹 select).
        next[item.position] = next[item.position] === choice ? null : choice;
        return next;
      });
    },
    [item],
  );

  const appendStroke = useCallback((questionIndex: number, stroke: InkStroke) => {
    setStrokes((prev) => ({ ...prev, [questionIndex]: [...(prev[questionIndex] ?? []), stroke] }));
  }, []);

  // "전체 지우기"는 지금 보고 있는 문항 것만 지운다(웹 clearCurrent).
  const clearDrawing = useCallback(() => {
    setStrokes((prev) => {
      if (!prev[index]) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }, [index]);

  const doSubmit = useCallback(async () => {
    setError(null);
    try {
      await submit.mutateAsync(answers);
      hapticSuccess();
      // 채점이 끝나면 임시 저장분은 필요 없다(그대로 두면 저장소에 계속 쌓인다).
      void clearReviewDraft(sessionId);
      // 결과 화면은 쿼리 캐시가 갈아 끼운다(useSubmitReview onSuccess) — 여기서 상태를 더 들지 않는다.
    } catch (e) {
      const handled = await handleEdgeError(e, {
        next: `/mypage/wrong-notes/${subjectSlug}/review/${sessionId}`,
      });
      if (handled.redirected) return;
      setError(handled.message);
    }
    // mutateAsync 는 안정 참조.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, sessionId, subjectSlug]);

  // 미답이 있으면 한 번 묻는다(웹 handleSubmit 의 confirm, 문구 동일). 최소 응시시간 검사는 없다.
  const handleSubmit = useCallback(() => {
    if (pending) return;
    if (answeredCount < total) {
      Alert.alert(`아직 ${total - answeredCount}문항을 안 풀었어요. 그래도 채점할까요?`, undefined, [
        { text: "취소", style: "cancel" },
        { text: "채점", onPress: () => void doSubmit() },
      ]);
      return;
    }
    void doSubmit();
  }, [pending, answeredCount, total, doSubmit]);

  const toolColor = (active: boolean) => (active ? "text-white" : "text-zinc-600 dark:text-zinc-400");
  const progress = total > 0 ? ((index + 1) / total) * 100 : 0;

  // 마지막 문항은 라벨 있는 큰 제출 버튼, 그 전엔 조기 채점 링크(웹 하단 바).
  const submitSlot = isLast ? (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: pending, busy: pending }}
      disabled={pending}
      onPress={handleSubmit}
      className={[
        "mt-3 w-full max-w-2xl flex-row items-center justify-center gap-1.5 self-center rounded-xl py-3",
        pending ? "bg-zinc-300 dark:bg-zinc-700" : "bg-blue-600 active:bg-blue-700",
      ].join(" ")}
    >
      <CheckIcon size={18} colorClassName="text-white" />
      <AppText variant="sm" weight="bold" className="text-white" tabular>
        {pending ? "채점 중..." : `제출하고 채점 (${answeredCount}/${total})`}
      </AppText>
    </Pressable>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: pending, busy: pending }}
      disabled={pending}
      onPress={handleSubmit}
      className={["mt-2 self-center", pending ? "opacity-50" : ""].join(" ")}
    >
      <AppText variant="xs" weight="medium" className="text-blue-600 dark:text-blue-400" tabular>
        {pending ? "채점 중..." : `지금 채점 (${answeredCount}/${total})`}
      </AppText>
    </Pressable>
  );

  return (
    <View className="flex-1 bg-white dark:bg-zinc-900">
      <View className="shrink-0 flex-row items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="나가기"
          onPress={confirmLeave}
          className="shrink-0 items-center justify-center rounded-lg p-1.5 active:bg-zinc-100 dark:active:bg-zinc-800"
        >
          <BackIcon size={20} colorClassName="text-zinc-600 dark:text-zinc-400" />
        </Pressable>
        <AppText
          variant="sm"
          weight="medium"
          numberOfLines={1}
          className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300"
        >
          {reviewSolverTitle(view)}
        </AppText>
        <View className="shrink-0 flex-row items-center gap-2">
          <View className="flex-row items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            <ToolButton tool="move" active={tool === "move"} label="화면 이동" onPress={setTool}>
              <HandIcon size={18} colorClassName={toolColor(tool === "move")} />
            </ToolButton>
            <ToolButton tool="pen" active={tool === "pen"} label="펜" onPress={setTool}>
              <PenIcon size={18} colorClassName={toolColor(tool === "pen")} />
            </ToolButton>
            <ToolButton tool="eraser" active={tool === "eraser"} label="지우개" onPress={setTool}>
              <EraserIcon size={18} colorClassName={toolColor(tool === "eraser")} />
            </ToolButton>
          </View>
          <AppText variant="sm" weight="semibold" tabular className="text-zinc-500 dark:text-zinc-400">
            {index + 1} / {total}
          </AppText>
        </View>
      </View>

      {/* 필기 도구를 골랐을 때만 색·굵기 줄(웹과 같이 tool !== 'move' 일 때만). */}
      {tool !== "move" && (
        <View className="shrink-0 border-b border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          <DrawingToolbar
            tool={tool}
            penColor={penColor}
            onPenColorChange={setPenColor}
            penWidth={penWidth}
            onPenWidthChange={setPenWidth}
            onClearDrawing={clearDrawing}
          />
        </View>
      )}

      {/* 진행도 */}
      <View className="h-1 shrink-0 bg-zinc-100 dark:bg-zinc-800">
        <View className="h-full bg-blue-600" style={{ width: `${progress}%` }} />
      </View>

      <SingleQuestionView
        questionIndex={index}
        questions={[
          {
            number: index + 1,
            choiceCount: item?.choiceCount ?? 4,
            selected: item ? (answers[item.position] ?? null) : null,
            onSelect: select,
            questionResult: null,
          },
        ]}
        images={item?.images ?? EMPTY_IMAGES}
        prevIndex={index > 0 ? index - 1 : null}
        nextIndex={isLast ? null : index + 1}
        onNavigate={setIndex}
        tool={tool}
        penColor={penColor}
        penWidth={penWidth}
        strokes={strokes[index] ?? []}
        onStrokeEnd={appendStroke}
        onSubmit={handleSubmit}
        submitting={pending}
        submitted={false}
        error={error}
        zoom={zoom}
        onPinchZoom={handlePinchZoom}
        caption={IMAGE_CAPTION}
        emptyImagesText={NO_IMAGE_TEXT}
        submitSlot={submitSlot}
      />
    </View>
  );
}

// 헤더 제목(웹 review-solver.tsx:261). 기출 섞어풀기(scope 'mix')는 내 오답이 아니라 과목 기출
// 전체에서 뽑은 새 문제라 "오답 다시 풀기"가 맞지 않는다.
export function reviewSolverTitle(view: ReviewSessionDetail): string {
  const head = isMixSession(view) ? "기출 섞어풀기" : "오답 다시 풀기";
  return view.subjectName ? `${head} · ${view.subjectName}` : head;
}

export function isMixSession(view: ReviewSessionDetail): boolean {
  return view.scope === "mix";
}
