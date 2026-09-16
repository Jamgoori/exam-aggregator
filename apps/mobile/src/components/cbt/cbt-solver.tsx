import { formatDuration, type CbtViewMode } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ChevronLeft, Clock, Eraser, Hand, PanelRightClose, PenLine } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { AppText } from "../app-text";
import { ReportQuestionButton } from "../papers/report-question-button";
import { Sheet } from "../sheet";
import { themedIcon } from "../../theme/icons";
import { CbtResultModal } from "./cbt-result-modal";
import { DrawingToolbar } from "./drawing-toolbar";
import { useExitGuard } from "./exit-guard";
import { FullView } from "./full-view";
import type { DrawTool } from "./ink-layer";
import { OmrPanel } from "./omr-panel";
import { useOmrSplit } from "./omr-split";
import { SingleQuestionView, useContentZoom } from "./single-question-view";
import { useCbtState } from "./use-cbt-state";
import { ViewModeTabs } from "./view-mode-tabs";

// CBT 솔버(웹 cbt-solver.tsx 의 폰 폭(<lg) 레이아웃 1:1, 설계서 §4.5 #22): 2줄 헤더(뒤로·제목·
// 타이머·도구·답안 입력 / 탭·자물쇠·문항 상태줄) + 도구줄 + 본문(문제별 보기 | 전체보기) + OMR
// 시트 + 결과 모달. 상태·규칙은 use-cbt-state.ts. 전체화면 버튼 없음(항상 몰입), lg 분기 미이식.
const BackIcon = themedIcon(ChevronLeft);
const ClockIcon = themedIcon(Clock);
const HandIcon = themedIcon(Hand);
const PenIcon = themedIcon(PenLine);
const EraserIcon = themedIcon(Eraser);
const PanelCloseIcon = themedIcon(PanelRightClose);
// 이미지가 없는 문항에 렌더마다 새 [] 를 주면 SingleQuestionView 의 useImageAspectRatios 가 타이머
// 틱마다 "문항이 바뀌었다"고 보고 실측 비율을 버린다 — 모듈 상수 하나로.
const EMPTY_IMAGES: string[] = [];
// 같은 이유로 "이 페이지엔 획이 없다"도 모듈 상수 하나로(렌더마다 새 [] 를 주면 InkLayer 가 매번 다시 그린다).
const EMPTY_STROKES: never[] = [];

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

export function CbtSolver({
  paperId,
  paperHref,
  paperTitle,
  fileUrl,
  totalQuestions,
  choiceCount,
  questionImages,
  questionChoiceCounts,
  defaultViewMode,
  userId,
}: {
  paperId: string;
  // 문제지 상세 주소(paperId 는 링크로 쓸 수 없다).
  paperHref: string;
  paperTitle: string;
  fileUrl: string;
  totalQuestions: number;
  choiceCount: number;
  questionImages: Record<number, string[]>;
  questionChoiceCounts: Record<number, number>;
  defaultViewMode: CbtViewMode | null;
  userId: string | null;
}) {
  const s = useCbtState({ paperId, userId, totalQuestions, questionImages, defaultViewMode });
  const { zoom, zoomIn, zoomOut, handlePinchZoom, setZoom } = useContentZoom();
  const { timer } = s;
  // 분할 비율은 솔버가 들고 있어 전체보기 ↔ 문제별 보기를 오가도 유지된다(kv 저장은 끌기 끝에).
  const omrSplit = useOmrSplit();
  // 전체 모드 = 좌우 분할, 문제별 모드 = 바텀시트(웹 sideOmr/sheetOmr, 설계서 §4.5 #22).
  const sideOmr = s.omrOpen && s.viewMode === "full";
  const sheetOmr = s.omrOpen && s.viewMode !== "full";

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(paperHref as Href);
  }, [paperHref]);
  const confirmLeave = useExitGuard(!s.result, leave);

  const toolColor = (active: boolean) => (active ? "text-white" : "text-zinc-600 dark:text-zinc-400");
  const statusNumber = s.isQuestionSet ? `${s.groupFirstNumber}~${s.groupLastNumber}번` : `${s.groupFirstNumber}번`;

  return (
    <View className="flex-1 bg-white dark:bg-zinc-900">
      {/* 헤더/탭/도구줄을 하나로 묶어 맨 아래에만 구분선. 말풍선·드롭다운이 본문 위로 뜨게 z-30. */}
      <View
        style={{ zIndex: 30, elevation: 30 }}
        className="shrink-0 border-b border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
      >
        <View className="flex-row items-center justify-between gap-3 px-4 py-2">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="문제지로 돌아가기"
              onPress={confirmLeave}
              className="shrink-0 items-center justify-center rounded-lg p-1.5 active:bg-zinc-100 dark:active:bg-zinc-800"
            >
              <BackIcon size={20} colorClassName="text-zinc-600 dark:text-zinc-400" />
            </Pressable>
            <AppText variant="sm" weight="medium" className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300" numberOfLines={1}>
              {paperTitle}
            </AppText>
          </View>
          <View className="shrink-0 flex-row items-center gap-2">
            <View className="flex-row items-center gap-1">
              <ClockIcon size={16} colorClassName="text-zinc-600 dark:text-zinc-400" />
              {/* idle(드래프트 확인 중)에도 웹처럼 "5초 후 시작" — "시작하는 중..." 은 cbt-start 응답 대기에만. */}
              {timer.phase === "countdown" || timer.phase === "idle" ? (
                <AppText variant="sm" weight="medium" tabular className="text-zinc-600 dark:text-zinc-400">
                  {timer.countdown}초 후 시작
                </AppText>
              ) : timer.phase === "start-error" ? (
                <Pressable accessibilityRole="button" onPress={timer.requestStart}>
                  <AppText variant="sm" weight="medium" className="text-red-600 underline dark:text-red-400">
                    시작 기록 실패, 다시 시도
                  </AppText>
                </Pressable>
              ) : timer.started ? (
                <AppText variant="sm" weight="medium" tabular className="text-zinc-600 dark:text-zinc-400">
                  {formatDuration(timer.elapsedSeconds)}
                </AppText>
              ) : (
                <AppText variant="sm" weight="medium" className="text-zinc-600 dark:text-zinc-400">
                  시작하는 중...
                </AppText>
              )}
            </View>
            {/* 도구 그룹은 두 모드 공통(웹과 같다) — 전체보기도 Phase 2 부터 펜·지우개가 있다. */}
            <View className="flex-row items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
              <ToolButton tool="move" active={s.tool === "move"} label="화면 이동" onPress={s.setTool}>
                <HandIcon size={18} colorClassName={toolColor(s.tool === "move")} />
              </ToolButton>
              <ToolButton tool="pen" active={s.tool === "pen"} label="펜" onPress={s.setTool}>
                <PenIcon size={18} colorClassName={toolColor(s.tool === "pen")} />
              </ToolButton>
              <ToolButton tool="eraser" active={s.tool === "eraser"} label="지우개" onPress={s.setTool}>
                <EraserIcon size={18} colorClassName={toolColor(s.tool === "eraser")} />
              </ToolButton>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: s.omrOpen }}
              onPress={() => s.setOmrOpen((open) => !open)}
              className={[
                "rounded-lg px-3 py-1.5",
                s.omrOpen ? "bg-zinc-200 dark:bg-zinc-700" : "bg-blue-600 active:bg-blue-700",
              ].join(" ")}
            >
              <AppText
                variant="sm"
                weight="medium"
                className={s.omrOpen ? "text-zinc-700 dark:text-zinc-200" : "text-white"}
              >
                답안 입력
              </AppText>
            </Pressable>
          </View>
        </View>

        <View className="flex-row items-center gap-1 px-3 py-1.5">
          <ViewModeTabs
            viewMode={s.viewMode}
            hasQuestionImages={s.hasQuestionImages}
            onSwitch={s.switchViewMode}
            savedDefaultViewMode={s.savedDefaultViewMode}
            onSavedDefaultViewModeChange={s.setSavedDefaultViewMode}
          />
          {/* 문제별 풀기 상태줄: 번호(세트는 "12~13번")·제출. 총 문항 수는 채점 후에만(360px 실측). */}
          {s.viewMode === "single" && (
            <View className="ml-auto min-w-0 flex-row items-center gap-1">
              <View className="min-w-0 flex-row items-center gap-1">
                <AppText variant="xs" weight="bold" className="text-zinc-800 dark:text-zinc-200" numberOfLines={1}>
                  {statusNumber}
                </AppText>
                {s.result && (
                  <AppText variant="xs" className="shrink-0 text-zinc-400 dark:text-zinc-600">
                    {" "}
                    / {totalQuestions}
                  </AppText>
                )}
                {/* 문항 오류 신고(웹 cbt-solver.tsx 상태줄과 같은 자리·같은 props). 세트문제는
                    웹과 같이 세트 첫 번호로 보낸다. 응시 중이라 사유는 core 가 "이미지/표시
                    오류"·"기타"만 남긴다(questionReportReasonsFor("cbt")). */}
                <ReportQuestionButton paperId={paperId} questionNumber={s.groupFirstNumber} context="cbt" />
              </View>
              {!s.result && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: s.submitting, busy: s.submitting }}
                  disabled={s.submitting}
                  onPress={s.handleSubmit}
                  className={[
                    "shrink-0 rounded-lg px-2 py-1",
                    s.submitting ? "bg-zinc-300 dark:bg-zinc-700" : "bg-blue-600 active:bg-blue-700",
                  ].join(" ")}
                >
                  <AppText variant="xs" weight="semibold" className="text-white" tabular>
                    {s.submitting
                      ? "채점 중..."
                      : s.isQuestionSet
                        ? "제출"
                        : `제출 ${s.answeredCount}/${totalQuestions}`}
                  </AppText>
                </Pressable>
              )}
            </View>
          )}
        </View>

        <DrawingToolbar
          tool={s.tool}
          penColor={s.penColor}
          onPenColorChange={s.setPenColor}
          penWidth={s.penWidth}
          onPenWidthChange={s.setPenWidth}
          onClearDrawing={s.clearDrawing}
        />
      </View>

      {/* 전체보기에서 OMR 을 시험지 위에 덮지 않고 좌우로 쪼갠다 — 시험지를 보면서 표기할 수
          있어야 하기 때문. 가운데 구분선을 끌면 폭이 바뀌고 그 폭은 기기에 저장된다. */}
      <View className="min-h-0 flex-1 flex-row" onLayout={omrSplit.onContainerLayout}>
        <View className="min-h-0 min-w-0 flex-1">
          {s.viewMode === "full" ? (
            <FullView
              fileUrl={fileUrl}
              zoom={zoom}
              onZoomChange={setZoom}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              tool={s.tool}
              penColor={s.penColor}
              penWidth={s.penWidth}
              page={s.fullPage}
              onPageChange={s.setFullPage}
              strokes={s.pageStrokes[s.fullPage] ?? EMPTY_STROKES}
              onStrokeEnd={s.appendPageStroke}
            />
          ) : (
            <SingleQuestionView
              questionIndex={s.currentQuestionIndex}
              questions={s.currentGroupNumbers.map((number) => ({
                number,
                // 문제별 뷰만 문항별 선지 수(패널은 문제지 단위).
                choiceCount: questionChoiceCounts[number] ?? choiceCount,
                selected: s.answers[number - 1] ?? null,
                onSelect: (choice: number) => s.selectChoice(number - 1, choice),
                questionResult: s.result ? (s.resultByQuestion.get(number) ?? null) : null,
              }))}
              images={questionImages[s.currentQuestionIndex + 1] ?? EMPTY_IMAGES}
              prevIndex={s.prevQuestionIndex}
              nextIndex={s.nextQuestionIndex}
              onNavigate={s.setCurrentQuestionIndex}
              tool={s.tool}
              penColor={s.penColor}
              penWidth={s.penWidth}
              strokes={s.singleStrokes[s.currentQuestionIndex] ?? []}
              onStrokeEnd={s.appendStroke}
              onSubmit={s.handleSubmit}
              submitting={s.submitting}
              submitted={!!s.result}
              error={s.error}
              zoom={zoom}
              onPinchZoom={handlePinchZoom}
            />
          )}
        </View>

        {sideOmr && (
          <>
            <GestureDetector gesture={omrSplit.gesture}>
              {/* 웹 구분선의 `active:bg-zinc-200` 은 미이식 — 제스처로 끄는 View 라 눌림 상태가 없다. */}
              <View
                accessibilityRole="adjustable"
                accessibilityLabel="시험지와 답안 입력 폭 조절"
                accessibilityValue={{ min: 30, max: 70, now: Math.round(omrSplit.ratio * 100) }}
                className="w-3 shrink-0 items-center justify-center bg-zinc-100 dark:bg-zinc-800"
              >
                <View className="h-10 w-0.5 rounded-full bg-zinc-400 dark:bg-zinc-500" />
              </View>
            </GestureDetector>
            <View
              style={{ width: `${omrSplit.ratio * 100}%` }}
              className="min-h-0 shrink-0 border-l border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
            >
              <View className="shrink-0 flex-row items-center justify-between gap-1 border-b border-zinc-100 px-2 py-1.5 dark:border-zinc-700">
                <AppText
                  variant="xs"
                  weight="semibold"
                  className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300"
                  numberOfLines={1}
                >
                  답안 입력
                </AppText>
                {/* 웹과 같이 패널을 접으면 OMR 이 닫힌다(setOmrOpen(false)) — 전체보기에서 "답안 입력"
                    을 다시 누르면 시트가 아니라 이 분할 패널이 돌아온다(설계서 §4.5 #22 "전체 모드
                    OMR = 좌우 분할"). 바텀시트는 문제별 보기의 OMR 로 그대로 남아 있다. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="답안 입력 닫기"
                  onPress={() => s.setOmrOpen(false)}
                  className="shrink-0 rounded-lg p-1 active:bg-zinc-100 dark:active:bg-zinc-800"
                >
                  <PanelCloseIcon size={16} colorClassName="text-zinc-500 dark:text-zinc-500" />
                </Pressable>
              </View>
              <OmrPanel
                className="min-h-0 flex-1"
                compact
                totalQuestions={totalQuestions}
                choiceCount={choiceCount}
                answers={s.answers}
                answeredCount={s.answeredCount}
                onSelect={s.selectChoice}
                onSubmit={s.handleSubmit}
                submitting={s.submitting}
                error={s.error}
                resultByQuestion={s.result ? s.resultByQuestion : null}
              />
            </View>
          </>
        )}
      </View>

      {/* OMR 시트는 문제별 보기 전용(전체보기는 위 좌우 분할). rounded-t-2xl, max 65%,
          overlay black/40, 웹 헤더 `px-4 py-2` text-sm font-semibold "답안 입력" + X 18, 핸들 없음. */}
      <Sheet visible={sheetOmr} onClose={() => s.setOmrOpen(false)} rounded="2xl" maxHeight="65%" title="답안 입력" compactHeader showHandle={false}>
        <OmrPanel
          totalQuestions={totalQuestions}
          choiceCount={choiceCount}
          answers={s.answers}
          answeredCount={s.answeredCount}
          onSelect={s.selectChoice}
          onSubmit={s.handleSubmit}
          submitting={s.submitting}
          error={s.error}
          resultByQuestion={s.result ? s.resultByQuestion : null}
        />
      </Sheet>

      {s.result && <CbtResultModal result={s.result} paperHref={paperHref} onRetry={s.handleRetry} />}
    </View>
  );
}
