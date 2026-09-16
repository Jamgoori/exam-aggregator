import type { QuestionExplanationContent, QuestionReportContext } from "@gongmoa/core";
import { useState } from "react";
import { View } from "react-native";
import { ExplanationDisclosure } from "./explanation-disclosure";
import { ExplanationLock } from "./explanation-lock";
import { AppText } from "../app-text";
import { ImageZoomModal } from "../image-zoom-modal";
import { ReportQuestionButton } from "../papers/report-question-button";
import { QuestionImage } from "../question-image";

// 카드 하나에 들어가는 답 줄. 세트문제(공통지문)는 이미지 한 벌에 답 줄이 여러 개 붙는다.
export type ExplanationCardRow = {
  questionNumber: number;
  selectedChoice: number | null;
  correctChoice: number | null;
  choiceCount: number;
  // 해설이 등록된 문항만 채워진다 (없으면 "해설 보기" 자체가 안 뜬다).
  explanation?: QuestionExplanationContent | null;
  // 해설은 등록돼 있지만 무료 회원이라 본문을 안 받은 문항 — 잠금 카드를 대신 그린다.
  explanationLocked?: boolean;
};

// 문항 카드(웹 wrong-note-question-card.tsx 의 해설 페이지용 부분집합, 설계서 §4.5 #24):
// 헤더 `{n}번`/`{n}~{m}번` → 문항 이미지(QuestionImage, 탭하면 확대) → 답 줄(정답 emerald-500;
// 세트면 줄 앞 `h-7 w-7 rounded-full bg-zinc-800` 번호 배지) → 해설(펼침/접힘/잠금).
// 오답노트 전용 배지(N번 틀림·극복·전국 오답률)는 wrong-notes/wrong-note-question-card 쪽에만
// 있다. 문항 오류 신고 버튼은 웹과 같이 `paperId` 를 준 화면에서만 뜬다(단일 문항은 번호 헤더
// 우측, 세트문제는 답 줄마다 — 웹 wrong-note-question-card.tsx reportButton()).
export function ExplanationCard({
  rows,
  images,
  // 전체 해설 페이지는 해설을 펼친 채로 시작하고 "내가 고른 답"/"풀지 않음" 표시는 숨긴다.
  explanationsOpen = false,
  showSelection = true,
  explanationLockNext,
  // 문항 오류 신고 버튼을 붙일 문제지 id(웹과 동일 — 주지 않으면 버튼이 뜨지 않는다).
  paperId,
  reportContext = "explanation",
}: {
  rows: ExplanationCardRow[];
  images: string[];
  explanationsOpen?: boolean;
  showSelection?: boolean;
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

  return (
    <View className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <View className="flex-row items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
        <AppText variant="sm" weight="bold" className="text-zinc-800 dark:text-zinc-200">
          {numberLabel}
        </AppText>
        {rows.length === 1 && reportButton(rows[0].questionNumber)}
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
            actions={rows.length > 1 ? reportButton(row.questionNumber) : undefined}
          />
        ))}
      </View>

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

// 정답(초록)/내가 고른 답(빨강) 색은 CBT 채점 화면과 동일.
function ChoiceRow({
  row,
  showNumberBadge,
  showSelection,
  // 세트문제(카드에 답 줄 여러 개)에서 줄마다 붙는 문항 신고 버튼.
  actions,
}: {
  row: ExplanationCardRow;
  showNumberBadge: boolean;
  showSelection: boolean;
  actions?: React.ReactNode;
}) {
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
              accessibilityLabel={isCorrect ? `${choice}번 정답` : `${choice}번`}
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
        {skipped && (
          <View className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
            <AppText variant="xs" weight="medium" className="text-zinc-500 dark:text-zinc-500">
              풀지 않음
            </AppText>
          </View>
        )}
        {actions}
      </View>
    </View>
  );
}
