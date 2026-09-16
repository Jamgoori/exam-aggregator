import type { QuestionExplanationContent, QuestionReportContext } from "@gongmoa/core";
import { useState } from "react";
import { View } from "react-native";
import { AppText } from "../app-text";
import { ExplanationDisclosure } from "../explanations/explanation-disclosure";
import { ExplanationLock } from "../explanations/explanation-lock";
import { ImageZoomModal } from "../image-zoom-modal";
import { ReportQuestionButton } from "../papers/report-question-button";
import { QuestionImage } from "../question-image";

// 오답노트 화면(회차별/과목별)이 공유하는 문제 카드(웹 wrong-note-question-card.tsx, 설계서 §4.5
// #24). 훅 없는 순수 표시 컴포넌트 — 응시 상세(Phase 1a)·과목 오답노트(Phase 2)·mix 기록이 그대로
// 쓴다. 세트 묶기는 core groupRowsBySharedImages(호출부). 문항 신고 버튼은 웹과 같이 `paperId`
// 를 준 화면에서만 뜬다(웹 wrong-note-question-card.tsx reportButton()) — 단일 문항 카드는 번호
// 헤더 우측, 세트문제는 답 줄마다.

// 카드 하나에 들어가는 답 줄. 세트문제(공통지문)는 이미지 한 벌에 답 줄이 여러 개 붙는다.
export type WrongNoteCardRow = {
  questionNumber: number;
  selectedChoice: number | null;
  correctChoice: number | null;
  choiceCount: number;
  // 해설이 등록된 문항만 채워진다 (없으면 "해설 보기" 자체가 안 뜬다).
  explanation?: QuestionExplanationContent | null;
  // 해설은 등록돼 있지만 무료 회원이라 본문을 안 받은 문항 — 본문 대신 잠금 카드를 그린다
  // (해설이 아예 없는 문항과 구분하려는 값).
  explanationLocked?: boolean;
  // 과목별 모아보기에서만 채워지는 값들 (회차별 보기에서는 undefined).
  wrongCount?: number;
  resolved?: boolean;
  // 전국 오답률(%). 표본 충분한 문항만(모아보기 전용).
  wrongRatePct?: number | null;
};

// 정답(초록)/내가 고른 답(빨강) 색은 CBT 채점 화면(single-question-view)과 동일.
function ChoiceRow({
  row,
  showNumberBadge,
  showSelection,
  actions,
}: {
  row: WrongNoteCardRow;
  showNumberBadge: boolean;
  showSelection: boolean;
  // 세트문제(카드에 답 줄 여러 개)에서 줄마다 붙는 문항 액션(다시보기 체크·삭제).
  actions?: React.ReactNode;
}) {
  // "내가 고른 답" 개념이 없는 화면(전체 해설)에서는 풀지 않음 배지를 숨긴다.
  const skipped = showSelection && row.selectedChoice === null;
  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {showNumberBadge && (
        <View className="h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800">
          <AppText variant="xs" weight="bold" allowFontScaling={false} className="text-white">
            {row.questionNumber}
          </AppText>
        </View>
      )}
      <View className="flex-row gap-1.5">
        {Array.from({ length: row.choiceCount }, (_, c) => c + 1).map((choice) => {
          const isCorrect = row.correctChoice === choice;
          const isMyWrongPick = !isCorrect && row.selectedChoice === choice;
          const cls = isCorrect
            ? "bg-emerald-500 text-white"
            : isMyWrongPick
              ? "bg-red-500 text-white"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500";
          return (
            <View
              key={choice}
              accessibilityLabel={isCorrect ? `${choice}번 정답` : isMyWrongPick ? `${choice}번 내가 고른 답` : `${choice}번`}
              className={["h-9 w-9 items-center justify-center rounded-full", cls].join(" ")}
            >
              <AppText variant="sm" weight="semibold" allowFontScaling={false} className={cls}>
                {choice}
              </AppText>
            </View>
          );
        })}
      </View>
      <View className="ml-auto shrink-0 flex-row items-center gap-1">
        {skipped && <Pill className="bg-zinc-100 dark:bg-zinc-800" textClassName="text-zinc-500 dark:text-zinc-500" label="풀지 않음" />}
        {row.wrongCount !== undefined && row.wrongCount >= 2 && (
          <Pill className="bg-amber-100 dark:bg-amber-950/30" textClassName="text-amber-700 dark:text-amber-400" label={`${row.wrongCount}번 틀림`} />
        )}
        {row.wrongRatePct != null && (
          <Pill
            className="bg-orange-100 dark:bg-orange-950/30"
            textClassName="text-orange-700 dark:text-orange-400"
            label={`전국 오답률 ${row.wrongRatePct}%`}
            accessibilityLabel={`전국 오답률 ${row.wrongRatePct}% — 이 문항을 푼 전체 응시자 중 틀린 비율`}
          />
        )}
        {row.resolved && <Pill className="bg-emerald-100 dark:bg-emerald-950/30" textClassName="text-emerald-700 dark:text-emerald-400" label="극복" />}
        {actions}
      </View>
    </View>
  );
}

function Pill({ className, textClassName, label, accessibilityLabel }: { className: string; textClassName: string; label: string; accessibilityLabel?: string }) {
  return (
    <View className={["rounded-full px-2 py-0.5", className].join(" ")} accessibilityLabel={accessibilityLabel}>
      <AppText variant="xs" weight="medium" allowFontScaling={false} className={textClassName}>
        {label}
      </AppText>
    </View>
  );
}

export function WrongNoteQuestionCard({
  rows,
  images,
  // 전체 해설 페이지용 옵션: 해설을 펼친 채로 시작하고, "내가 고른 답"/"풀지 않음" 표시는 숨긴다.
  explanationsOpen = false,
  showSelection = true,
  // 오답노트 화면에서 문항별 액션(다시보기 체크·삭제)을 붙일 때. 단일 문항 카드는 번호 헤더
  // 우측 끝에, 세트문제는 답 줄마다 붙는다.
  renderRowActions,
  // 해설 잠금 카드의 "멤버십 보러 가기"가 돌아올 곳(현재 화면 주소).
  explanationLockNext,
  // 문항 오류 신고 버튼을 붙일 문제지 id. 이 값을 주는 화면에서만 신고 버튼이 뜬다(웹과 동일).
  paperId,
  reportContext = "explanation",
}: {
  rows: WrongNoteCardRow[];
  images: string[];
  explanationsOpen?: boolean;
  showSelection?: boolean;
  renderRowActions?: (questionNumber: number) => React.ReactNode;
  explanationLockNext?: string;
  paperId?: string;
  reportContext?: QuestionReportContext;
}) {
  const [zoom, setZoom] = useState<{ uri: string; label: string } | null>(null);
  const firstNumber = rows[0]?.questionNumber;
  const lastNumber = rows[rows.length - 1]?.questionNumber;
  const numberLabel = firstNumber === lastNumber ? `${firstNumber}번` : `${firstNumber}~${lastNumber}번`;

  const reportButton = (questionNumber: number) =>
    paperId ? <ReportQuestionButton paperId={paperId} questionNumber={questionNumber} context={reportContext} /> : null;

  const headerActions =
    rows.length === 1 && (renderRowActions || paperId) ? (
      <View className="shrink-0 flex-row items-center gap-1">
        {renderRowActions?.(rows[0].questionNumber)}
        {reportButton(rows[0].questionNumber)}
      </View>
    ) : null;

  return (
    <View className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <View className="flex-row items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
        <AppText variant="sm" weight="bold" className="text-zinc-800 dark:text-zinc-200">
          {numberLabel}
        </AppText>
        {headerActions}
      </View>

      {images.length > 0 ? (
        <View>
          {images.map((src, i) => {
            const label = `${numberLabel} 문제 이미지 ${i + 1}`;
            return <QuestionImage key={`${src}-${i}`} path={src} accessibilityLabel={label} onPress={() => setZoom({ uri: src, label })} />;
          })}
        </View>
      ) : (
        <AppText variant="xs" className="px-4 py-6 text-center text-zinc-400 dark:text-zinc-500" pretty>
          아직 이 문제의 이미지가 등록되지 않았어요. 문제 내용은 원본 문제지에서 확인해주세요.
        </AppText>
      )}

      <View className="gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-700">
        {rows.map((row) => (
          <ChoiceRow
            key={row.questionNumber}
            row={row}
            showNumberBadge={rows.length > 1}
            showSelection={showSelection}
            actions={
              rows.length > 1 && (renderRowActions || paperId) ? (
                <>
                  {renderRowActions?.(row.questionNumber)}
                  {reportButton(row.questionNumber)}
                </>
              ) : undefined
            }
          />
        ))}
      </View>

      {/* 해설: 먼저 스스로 다시 풀어보게 기본은 접어두고, 누르면 펼친다. 무료 회원(explanationLocked)은
          본문이 서버에서 오지 않으므로 잠금 카드를 대신 그린다. */}
      {rows.some((row) => row.explanation || row.explanationLocked) && (
        <View className="gap-1 border-t border-zinc-100 px-4 py-3 dark:border-zinc-700">
          {rows
            .filter((row) => row.explanation || row.explanationLocked)
            .map((row) =>
              !row.explanation ? (
                <ExplanationLock key={row.questionNumber} questionNumber={row.questionNumber} showNumber={rows.length > 1} next={explanationLockNext} />
              ) : (
                <ExplanationDisclosure
                  key={row.questionNumber}
                  explanation={row.explanation}
                  correctChoice={row.correctChoice}
                  questionNumber={row.questionNumber}
                  showNumber={rows.length > 1}
                  defaultOpen={explanationsOpen}
                />
              ),
            )}
        </View>
      )}

      <ImageZoomModal uri={zoom?.uri ?? null} label={zoom?.label} onClose={() => setZoom(null)} />
    </View>
  );
}

// 초록=정답, 빨강=내가 고른 답 규칙을 화면마다 한 번씩 설명해주는 범례.
export function WrongNoteLegend() {
  return (
    <View className="flex-row items-center gap-3">
      <View className="flex-row items-center gap-1">
        <View className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
          정답
        </AppText>
      </View>
      <View className="flex-row items-center gap-1">
        <View className="h-2.5 w-2.5 rounded-full bg-red-500" />
        <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
          내가 고른 답
        </AppText>
      </View>
    </View>
  );
}
