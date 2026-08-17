import { ChevronRight } from "lucide-react";
import {
  ExplanationBody,
  type QuestionExplanationContent,
} from "@/components/explanation-body";
import { ExplanationDisclosure } from "@/components/explanation-disclosure";
import { ExplanationLock } from "@/components/explanation-lock";
import { ReportQuestionButton } from "@/components/report-question-button";

// 오답노트 화면(회차별/과목별)이 공유하는 문제 카드. 훅을 쓰지 않는 순수 표시용
// 컴포넌트라 서버 컴포넌트(회차 페이지)와 클라이언트 컴포넌트(과목 페이지의 필터
// 목록) 어느 쪽에서든 그대로 가져다 쓸 수 있다.

// 해설 본문 타입은 explanation-body로 옮겼지만, 여기서 가져다 쓰던 곳들이 많아
// 기존 import 경로를 그대로 유지하도록 재노출한다.
export type { QuestionExplanationContent };

// 카드 하나에 들어가는 답 줄. 세트문제(공통지문)는 이미지 한 벌에 답 줄이 여러 개 붙는다.
export type WrongNoteCardRow = {
  questionNumber: number;
  selectedChoice: number | null;
  correctChoice: number | null;
  choiceCount: number;
  // 해설이 등록된 문항만 채워진다 (없으면 "해설 보기" 자체가 안 뜬다).
  explanation?: QuestionExplanationContent | null;
  // 해설은 등록돼 있지만 무료 회원이라 본문을 안 받은 문항. 이 자리에는 본문 대신
  // 잠금 카드를 그린다(해설이 아예 없는 문항과 구분하려는 값 — 없는 문항까지 잠금으로
  // 덮으면 결제 후 빈 자리만 남는다).
  explanationLocked?: boolean;
  // 과목별 모아보기에서만 채워지는 값들 (회차별 보기에서는 undefined).
  wrongCount?: number;
  resolved?: boolean;
  // 전국 오답률(%). 표본 충분한 문항만(모아보기 전용).
  wrongRatePct?: number | null;
};

// CBT 문제별 보기(cbt-solver)와 같은 규칙으로 세트문제를 묶는다: 크롭 스크립트가
// 세트에 속한 문제들에 완전히 같은 이미지 경로를 저장하므로, 연속된 오답의 이미지
// 배열이 동일하면 같은 지문을 두 번 그리지 않고 카드 하나로 합친다.
export function groupRowsBySharedImages<T extends { images: string[] }>(
  items: T[],
): { images: string[]; rows: T[] }[] {
  const groups: { images: string[]; rows: T[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.images.length > 0 &&
      item.images.length === last.images.length &&
      item.images.every((src, i) => src === last.images[i])
    ) {
      last.rows.push(item);
    } else {
      groups.push({ images: item.images, rows: [item] });
    }
  }
  return groups;
}

// 정답(초록)/내가 고른 답(빨강) 색은 CBT 채점 화면(single-question-view)과 동일하게
// 맞춰서, 시험을 막 마친 사용자가 오답노트에서도 같은 문법으로 읽을 수 있게 한다.
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
  // 전체 해설 페이지처럼 "내가 고른 답" 개념이 없는 화면에서는 풀지 않음 배지를 숨긴다.
  const skipped = showSelection && row.selectedChoice === null;
  return (
    <div className="flex flex-wrap items-center gap-2 break-inside-avoid">
      {showNumberBadge && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-white print:h-5 print:w-5 print:text-[10px]">
          {row.questionNumber}
        </span>
      )}
      <div className="flex gap-1.5">
        {Array.from({ length: row.choiceCount }, (_, c) => c + 1).map((choice) => {
          const isCorrect = row.correctChoice === choice;
          const isMyWrongPick = !isCorrect && row.selectedChoice === choice;
          return (
            <span
              key={choice}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold print:h-6 print:w-6 print:text-xs ${
                isCorrect
                  ? "bg-emerald-500 text-white"
                  : isMyWrongPick
                    ? "bg-red-500 text-white"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
              }`}
            >
              {choice}
            </span>
          );
        })}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {skipped && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
            풀지 않음
          </span>
        )}
        {row.wrongCount !== undefined && row.wrongCount >= 2 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            {row.wrongCount}번 틀림
          </span>
        )}
        {row.wrongRatePct != null && (
          <span
            className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-950/30 dark:text-orange-400"
            title="이 문항을 푼 전체 응시자 중 틀린 비율"
          >
            전국 오답률 {row.wrongRatePct}%
          </span>
        )}
        {row.resolved && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
            극복
          </span>
        )}
        {actions}
      </div>
    </div>
  );
}

export function WrongNoteQuestionCard({
  rows,
  images,
  // 전체 해설 페이지용 옵션: 해설을 펼친 채로 시작하고(복습이 아니라 열람이 목적),
  // "내가 고른 답"/"풀지 않음" 표시는 숨긴다.
  explanationsOpen = false,
  showSelection = true,
  // 해설 페이지(?download=1)는 로드 직후 window.print()를 띄우는데, lazy 이미지는
  // 브라우저에 따라 화면 밖 문항이 안 실린 채 인쇄될 수 있어 eager로 전환한다.
  eagerImages = false,
  // 오답노트 화면에서 문항별 액션(다시보기 체크·삭제)을 붙일 때 쓴다. 단일 문항
  // 카드는 번호 헤더 우측 끝에, 세트문제는 답 줄마다 붙는다.
  renderRowActions,
  // 해설 잠금 카드의 "멤버십 보러 가기"가 결제 후 돌아올 곳(현재 화면 주소).
  explanationLockNext,
  // 문항 오류 신고 버튼을 붙일 문제지 id. 이 값을 주는 화면(전체 해설 페이지)에서만
  // 신고 버튼이 뜬다 — 오답노트처럼 아직 paperId를 안 넘기는 화면은 그대로 안 보인다.
  paperId,
  reportContext = "explanation",
}: {
  rows: WrongNoteCardRow[];
  images: string[];
  explanationsOpen?: boolean;
  showSelection?: boolean;
  eagerImages?: boolean;
  renderRowActions?: (questionNumber: number) => React.ReactNode;
  explanationLockNext?: string;
  paperId?: string;
  reportContext?: "explanation" | "cbt";
}) {
  const firstNumber = rows[0]?.questionNumber;
  const lastNumber = rows[rows.length - 1]?.questionNumber;
  const numberLabel =
    firstNumber === lastNumber ? `${firstNumber}번` : `${firstNumber}~${lastNumber}번`;

  function reportButton(questionNumber: number) {
    return paperId ? (
      <ReportQuestionButton
        paperId={paperId}
        questionNumber={questionNumber}
        context={reportContext}
      />
    ) : null;
  }

  const hasHeaderActions = rows.length === 1 && (!!renderRowActions || !!paperId);
  const headerActions = hasHeaderActions ? (
    <>
      {renderRowActions?.(rows[0].questionNumber)}
      {reportButton(rows[0].questionNumber)}
    </>
  ) : null;

  return (
    // print:mb-3: 해설 인쇄가 2단 그리드로 전환되면(page.tsx의 print:grid) 그리드
    // 줄 간격을 이 아래 margin으로 준다. 화면에는 영향 없음.
    // 페이지/줄 나눔은 카드 통째가 아니라 카드 안 작은 블록 단위(이미지·답 줄·
    // 해설 항목)의 break-inside-avoid로 제어한다 — 카드 전체에 avoid를 걸면 긴
    // 카드가 통째로 다음 페이지로 밀리며 아래가 비기 때문.
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white print:mb-3 dark:border-zinc-700 dark:bg-zinc-900">
      {/* print:hidden: 문제 이미지에 이미 번호가 있어 인쇄물에서는 중복이라 뺀다. */}
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 print:hidden dark:border-zinc-700 dark:bg-zinc-800/50">
        <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{numberLabel}</span>
        {headerActions && <span className="print:hidden">{headerActions}</span>}
      </div>

      {images.length > 0 ? (
        <div className="flex flex-col">
          {/* 인쇄: 이미지를 인쇄 폭 전체로 확대하면 원본 시험지보다 훨씬 커져 문항
              하나가 페이지를 넘겨버린다. 크롭 스크립트가 항상 PDF 1pt당 3px(scale=3)로
              렌더링하므로, 원본 크기(zoom 0.444)가 되는 배율 기준으로 zoom 0.5를 걸면
              레이아웃(2단/1단)과 무관하게 어떤 크롭이든 "원본 시험지의 약 1.13배"
              크기로 인쇄된다. 1단(전체 폭) 크롭은 max-w-full에 걸려 인쇄 폭에 맞게
              들어간다. break-inside-avoid로 이미지 자체는 페이지 경계에서 잘리지
              않게 한다. */}
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt={`${numberLabel} 문제 이미지 ${i + 1}`}
              loading={eagerImages ? "eager" : "lazy"}
              className="w-full break-inside-avoid print:w-auto print:max-w-full print:self-center print:[zoom:0.5]"
            />
          ))}
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500">
          아직 이 문제의 이미지가 등록되지 않았어요. 문제 내용은 원본 문제지에서
          확인해주세요.
        </p>
      )}

      {/* print:hidden: 인쇄물에서 정답 원 줄은 공간만 차지한다 — 정답은 해설의
          "정답" 요약 줄과 선지별 해설의 에메랄드 번호로 이미 전달된다. */}
      <div className="flex flex-col gap-2 border-t border-zinc-100 px-4 py-3 print:hidden dark:border-zinc-700">
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
      </div>

      {/* 해설: 먼저 스스로 다시 풀어보게 기본은 접어두고, 누르면 펼친다.
          - 전체 해설 페이지(explanationsOpen)는 처음부터 펼쳐 두고 인쇄까지 하므로
            예전처럼 서버에서 통째로 그린다.
          - 오답노트 목록은 접힌 채로 시작하므로 ExplanationDisclosure가 실제로 펼친
            해설만 그린다(문항 수백 개짜리 목록의 첫 화면을 가볍게 하려는 분리).
          - 무료 회원(explanationLocked)은 본문이 서버에서 오지 않으므로 잠금 카드를
            대신 그린다 — 자리를 비우면 "해설 없는 문항"과 구분이 안 된다. */}
      {rows.some((row) => row.explanation || row.explanationLocked) && (
        <div className="flex flex-col gap-1 border-t border-zinc-100 px-4 py-3 print:py-1.5 dark:border-zinc-700">
          {rows
            .filter((row) => row.explanation || row.explanationLocked)
            .map((row) =>
              !row.explanation ? (
                <ExplanationLock
                  key={row.questionNumber}
                  questionNumber={row.questionNumber}
                  showNumber={rows.length > 1}
                  next={explanationLockNext}
                />
              ) : explanationsOpen ? (
                <details key={row.questionNumber} open className="group">
                  {/* 인쇄에서 "해설 보기" 토글 줄은 숨긴다. 단, 세트문제(카드에 해설
                      여러 개)는 이 줄이 몇 번 해설인지 알려주는 유일한 라벨이라
                      남기고, 토글 화살표만 뺀다. */}
                  <summary
                    className={`flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-blue-600 hover:underline [&::-webkit-details-marker]:hidden dark:text-blue-400 ${
                      rows.length > 1
                        ? "print:text-xs print:text-zinc-800"
                        : "print:hidden"
                    }`}
                  >
                    <ChevronRight
                      size={14}
                      className="shrink-0 transition-transform group-open:rotate-90 print:hidden"
                    />
                    {rows.length > 1 ? (
                      <>
                        <span className="print:hidden">{row.questionNumber}번 해설 보기</span>
                        <span className="hidden print:inline">{row.questionNumber}번 해설</span>
                      </>
                    ) : (
                      "해설 보기"
                    )}
                  </summary>
                  <ExplanationBody
                    explanation={row.explanation!}
                    correctChoice={row.correctChoice}
                  />
                </details>
              ) : (
                <ExplanationDisclosure
                  key={row.questionNumber}
                  explanation={row.explanation!}
                  correctChoice={row.correctChoice}
                  questionNumber={row.questionNumber}
                  showNumber={rows.length > 1}
                />
              ),
            )}
        </div>
      )}
    </div>
  );
}

// 초록=정답, 빨강=내가 고른 답 규칙을 화면마다 한 번씩 설명해주는 범례.
export function WrongNoteLegend() {
  return (
    <p className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-500">
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
        정답
      </span>
      <span className="flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
        내가 고른 답
      </span>
    </p>
  );
}
