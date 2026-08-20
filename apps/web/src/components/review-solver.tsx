"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Hand,
  PenLine,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  submitReviewSession,
  createReviewFromWrong,
  markReviewGuessed,
} from "@/app/mypage/wrong-notes/actions";
import { CbtDrawingToolbar, PEN_COLORS } from "@/components/cbt-drawing-toolbar";
import { clearReviewFabCache } from "@/components/review-fab";
import { ReviewScheduleSection } from "@/components/review-schedule-section";
import { DEFAULT_PEN_WIDTH, type DrawTool } from "@/components/pdf-canvas-viewer";
import { useQuestionImagePreload } from "@/components/question-image-preload";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  useContentZoom,
  useFitContentWidth,
  useQuestionDrawing,
  useSwipeNavigation,
} from "@/components/question-view-gestures";
import type { ReviewSessionView } from "@/lib/review-session";

// 섞어풀기 풀이 화면. 문제지 경계 없이 섞인 오답을 순서대로 풀고 채점한다. 풀이
// 중에는 출처(문제지·번호)와 정답을 숨겨 힌트가 되지 않게 하고, 채점 후에만 공개한다.
// CBT 솔버(PDF·최소응시시간)와 달리 순수 문항 리스트라 가볍게 따로 뒀지만, 문제를
// 다루는 조작(필기 캔버스, 쓸어넘김 이동, 핀치·버튼 확대, 화면 높이에 맞춘 문제 폭)은
// CBT 문제별 풀기와 같은 코드(question-view-gestures)를 그대로 쓴다.
// 푸는 중인 답을 기기에 임시 저장한다. 복습은 매일 여는 기능이고 대부분 모바일에서
// 푸는데, 20문항 중 15개를 풀고 탭이 죽으면 처음부터가 된다 — 그 한 번으로 습관이
// 끊긴다. 서버에 저장하지 않는 건 채점 전 선택이 새어 나가면 안 되기 때문이 아니라
// (어차피 본인 것) 매 선택마다 왕복을 만들 이유가 없어서다.
//
// 세션 id로 키를 잡아 다른 세션과 안 섞이게 하고, 채점이 끝나면 지운다.
const DRAFT_PREFIX = "review-draft:";

function draftKey(sessionId: string): string {
  return `${DRAFT_PREFIX}${sessionId}`;
}

function loadDraftAnswers(sessionId: string, total: number): (number | null)[] {
  const empty = Array(total).fill(null) as (number | null)[];
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(draftKey(sessionId));
    if (!raw) return empty;
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return empty;
    // 길이가 다르면(문항이 바뀔 일은 없지만) 있는 만큼만 채운다.
    return empty.map((_, i) => {
      const v = saved[i];
      return Number.isInteger(v) ? (v as number) : null;
    });
  } catch {
    // 무시: 저장소를 못 읽어도 처음부터 풀 수 있으면 된다(사파리 프라이빗 등).
    return empty;
  }
}

function saveDraftAnswers(sessionId: string, answers: (number | null)[]): void {
  try {
    window.localStorage.setItem(draftKey(sessionId), JSON.stringify(answers));
  } catch {
    // 무시: 용량 초과·프라이빗 모드에서도 풀이 자체는 계속돼야 한다.
  }
}

function clearDraftAnswers(sessionId: string): void {
  try {
    window.localStorage.removeItem(draftKey(sessionId));
  } catch {
    // 무시.
  }
}

export function ReviewSolver({
  initial,
  backHref,
  subjectSlug,
}: {
  initial: ReviewSessionView;
  backHref: string;
  subjectSlug: string;
}) {
  const [view, setView] = useState<ReviewSessionView>(initial);
  const [answers, setAnswers] = useState<(number | null)[]>(() =>
    loadDraftAnswers(initial.id, initial.total),
  );
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submitted = view.submitted;
  const answeredCount = answers.filter((a) => a !== null).length;

  // 필기 도구 상태. CBT 문제별 풀기(SingleQuestionView)와 같은 캔버스를 문제 카드
  // 위에 덮고, 문항별 필기 보관·다시 그리기도 같은 훅(useQuestionDrawing)에 맡긴다.
  const [tool, setTool] = useState<DrawTool>("move");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState(DEFAULT_PEN_WIDTH);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { zoom, zoomIn, zoomOut, handlePinchZoom } = useContentZoom();

  // 문항별로 필기를 기록해둬서 앞뒤로 오가도, 확대/축소해도 남아 있게 한다.
  // "전체 지우기"(clearDrawing)는 지금 보고 있는 문항 것만 지운다.
  const { clearCurrent: clearDrawing } = useQuestionDrawing({
    scrollAreaRef,
    contentRef,
    canvasRef,
    itemKey: index,
    tool,
    penColor,
    penWidth,
    onPinchZoom: handlePinchZoom,
    // 채점이 끝나면 결과 화면으로 바뀌어 캔버스 자체가 사라진다.
    enabled: !submitted,
  });

  // 넘길 때마다 이미지를 새로 받으면 번호만 먼저 바뀌고 문제 사진이 늦게 뜬다. CBT
  // 문제별 풀기와 같은 큐로, 지금 보고 있는 문항부터 순서대로 미리 받아둔다(한꺼번에
  // 다 요청하면 눈앞의 문항이 나머지와 대역폭을 나눠 쓰느라 오히려 늦게 뜬다).
  const imagesByItem = useMemo(() => view.items.map((it) => it.images), [view.items]);
  useQuestionImagePreload({
    enabled: !submitted,
    imagesByItem,
    currentIndex: index,
  });

  // 문제 폭·쓸어넘김·핀치는 CBT 문제별 풀기와 같은 훅을 쓴다. 훅은 채점 후 조기
  // 반환(ReviewResult)보다 위에서 불러야 호출 순서가 항상 같다.
  const { contentWidth, handleImageLoad } = useFitContentWidth({
    scrollAreaRef,
    itemKey: index,
    imageCount: view.items[index]?.images.length ?? 0,
    zoom,
  });
  const swipeHandlers = useSwipeNavigation({
    tool,
    onPrev: () => goPrev(),
    onNext: () => goNext(),
    onPinchZoom: handlePinchZoom,
  });

  // 고른 답이 바뀔 때마다 기기에 담아둔다. 탭이 죽거나 실수로 나가도 같은 주소로
  // 돌아오면 이어서 풀 수 있다.
  const dirty = !submitted && answeredCount > 0;
  useEffect(() => {
    if (submitted) return;
    saveDraftAnswers(view.id, answers);
  }, [answers, submitted, view.id]);

  // 채점이 끝나면 임시 저장분은 필요 없다(그대로 두면 저장소에 계속 쌓인다).
  useEffect(() => {
    if (submitted) clearDraftAnswers(view.id);
  }, [submitted, view.id]);

  // 저장은 되지만 "다시 찾아오는 길"이 카드에서 새 세션을 만드는 것뿐이라, 나가는
  // 순간에는 여전히 한 번 잡아준다. 문구는 사라진다가 아니라 이어서 풀 수 있다로.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function confirmLeave(e: React.MouseEvent) {
    if (
      dirty &&
      !window.confirm("아직 채점 전이에요. 이 주소로 돌아오면 이어서 풀 수 있어요. 나갈까요?")
    ) {
      e.preventDefault();
    }
  }

  if (submitted) {
    return <ReviewResult view={view} backHref={backHref} subjectSlug={subjectSlug} />;
  }

  const item = view.items[index];
  const isLast = index >= view.items.length - 1;

  function select(choice: number) {
    setAnswers((prev) => {
      const next = [...prev];
      next[item.position] = next[item.position] === choice ? null : choice;
      return next;
    });
  }

  function goPrev() {
    setIndex((i) => Math.max(0, i - 1));
  }

  function goNext() {
    setIndex((i) => Math.min(view.items.length - 1, i + 1));
  }

  function handleSubmit() {
    if (isPending) return;
    if (
      answeredCount < view.total &&
      !window.confirm(
        `아직 ${view.total - answeredCount}문항을 안 풀었어요. 그래도 채점할까요?`,
      )
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submitReviewSession({ sessionId: view.id, answers });
      if (res.error || !res.view) {
        setError(res.error ?? "채점에 실패했어요.");
        return;
      }
      // 오늘 남은 복습 수가 방금 달라졌다. 안 지우면 다 풀고도 플로팅 버튼이
      // 계속 따라다닌다.
      clearReviewFabCache();
      setView(res.view);
    });
  }

  return (
    <div className="flex h-[100dvh] flex-col lg:h-[calc(100dvh-65px)]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
        <Link
          href={backHref}
          aria-label="나가기"
          onClick={confirmLeave}
          className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <ChevronLeft size={20} />
        </Link>
        <h1 className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
          오답 다시 풀기{view.subjectName ? ` · ${view.subjectName}` : ""}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {/* 모바일은 헤더가 좁아 넣지 못하고(그쪽은 두 손가락 핀치로 확대한다),
              CBT와 같이 lg 이상에서만 배율 버튼을 보여준다. */}
          <div className="hidden items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 lg:flex dark:bg-zinc-800">
            <button
              type="button"
              onClick={zoomOut}
              disabled={zoom <= MIN_ZOOM}
              aria-label="문제 축소"
              className="flex items-center justify-center rounded-md p-1.5 text-zinc-600 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700"
            >
              <ZoomOut size={18} />
            </button>
            <span className="w-10 text-center text-xs font-medium text-zinc-500 dark:text-zinc-500">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              disabled={zoom >= MAX_ZOOM}
              aria-label="문제 확대"
              className="flex items-center justify-center rounded-md p-1.5 text-zinc-600 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-700"
            >
              <ZoomIn size={18} />
            </button>
          </div>
          <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            <button
              type="button"
              onClick={() => setTool("move")}
              aria-label="화면 이동"
              aria-pressed={tool === "move"}
              className={`flex items-center justify-center rounded-md p-1.5 ${
                tool === "move"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
            >
              <Hand size={18} />
            </button>
            <button
              type="button"
              onClick={() => setTool("pen")}
              aria-label="펜"
              aria-pressed={tool === "pen"}
              className={`flex items-center justify-center rounded-md p-1.5 ${
                tool === "pen"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
            >
              <PenLine size={18} />
            </button>
            <button
              type="button"
              onClick={() => setTool("eraser")}
              aria-label="지우개"
              aria-pressed={tool === "eraser"}
              className={`flex items-center justify-center rounded-md p-1.5 ${
                tool === "eraser"
                  ? "bg-blue-600 text-white"
                  : "text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
              }`}
            >
              <Eraser size={18} />
            </button>
          </div>
          <span className="text-sm font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
            {index + 1} / {view.total}
          </span>
        </div>
      </header>

      {tool !== "move" && (
        <div className="shrink-0 border-b border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          <CbtDrawingToolbar
            tool={tool}
            penColor={penColor}
            onPenColorChange={setPenColor}
            penWidth={penWidth}
            onPenWidthChange={setPenWidth}
            onClearDrawing={clearDrawing}
          />
        </div>
      )}

      {/* 진행도 */}
      <div className="h-1 shrink-0 bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full bg-blue-600 transition-[width]"
          style={{ width: `${((index + 1) / view.total) * 100}%` }}
        />
      </div>

      <div
        ref={scrollAreaRef}
        {...swipeHandlers}
        // pan-y로 두면 세로 스크롤(한 손가락)은 그대로 두고 브라우저 기본 핀치줌만
        // 꺼져서, 두 손가락 핀치를 위 핸들러가 문제 확대/축소로 쓸 수 있다.
        style={{ touchAction: "pan-y" }}
        className="min-h-0 flex-1 overflow-y-auto bg-zinc-100 px-4 py-4 dark:bg-zinc-800"
      >
        <div
          ref={contentRef}
          style={{ maxWidth: `${contentWidth}px` }}
          className="relative mx-auto flex min-h-full w-full flex-col gap-2 overflow-hidden rounded-lg border border-zinc-200 bg-white"
        >
          {item.images.length === 0 ? (
            <p className="py-24 text-center text-sm text-zinc-400 dark:text-zinc-600">
              이 문제의 이미지가 없어요.
            </p>
          ) : (
            item.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={src}
                alt={`문제 ${index + 1} 이미지 ${i + 1}`}
                // 지금 보고 있는 문항 이미지는 화면에서 제일 급한 자원이다. 뒤에서
                // 미리 받아두는 나머지 문항(fetchPriority=low)에 밀리지 않게 명시한다.
                fetchPriority="high"
                decoding="async"
                className="w-full"
                onLoad={(e) => handleImageLoad(i, e.currentTarget)}
              />
            ))
          )}
          <canvas
            ref={canvasRef}
            className="absolute left-0 top-0"
            style={{ touchAction: "none" }}
          />
        </div>
        <p className="mx-auto mt-3 max-w-2xl text-center text-xs text-zinc-400 dark:text-zinc-600">
          출처와 정답은 채점 후에 공개돼요.
        </p>
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900">
        {error && (
          <p className="mx-auto mb-2 max-w-2xl text-center text-xs text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <button
            type="button"
            aria-label="이전 문제"
            disabled={index === 0}
            onClick={goPrev}
            className="flex shrink-0 items-center justify-center rounded-full p-2 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <ChevronLeft size={22} />
          </button>

          <div className="flex flex-1 justify-center gap-2">
            {Array.from({ length: item.choiceCount }, (_, c) => c + 1).map((choice) => {
              const isSelected = answers[item.position] === choice;
              return (
                <button
                  key={choice}
                  type="button"
                  onClick={() => select(choice)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                    isSelected
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  }`}
                >
                  {choice}
                </button>
              );
            })}
          </div>

          {isLast ? (
            <div className="w-[38px] shrink-0" aria-hidden />
          ) : (
            <button
              type="button"
              aria-label="다음 문제"
              onClick={goNext}
              className="flex shrink-0 items-center justify-center rounded-full p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <ChevronRight size={22} />
            </button>
          )}
        </div>
        {/* 마지막 문항: 작은 아이콘 대신 라벨 있는 큰 제출 버튼. 그 외: 조기 채점 링크. */}
        {isLast ? (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="mx-auto mt-3 flex w-full max-w-2xl items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
          >
            <Check size={18} />
            {isPending ? "채점 중..." : `제출하고 채점 (${answeredCount}/${view.total})`}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="mx-auto mt-2 block text-xs font-medium text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
          >
            {isPending ? "채점 중..." : `지금 채점 (${answeredCount}/${view.total})`}
          </button>
        )}
      </div>
    </div>
  );
}

// "찍었어요" 토글. 한 번 누르면 되돌리지 않는다 — 취소까지 두면 정답 화면에서
// 판단할 거리가 하나 더 늘고, 잘못 눌러도 손해가 "며칠 뒤에 한 번 더 본다"뿐이다.
//
// 누른 뒤 문구를 "표시했어요"로만 두는 건, 이 화면이 복습 세션과 섞어풀기 양쪽에
// 쓰이고 후자에는 스케줄이 없는 문항이 섞여 있기 때문이다. 전부에 "곧 다시 나와요"를
// 약속하면 지키지 못하는 경우가 생긴다.
function GuessedButton({
  sessionId,
  position,
  initial,
}: {
  sessionId: string;
  position: number;
  initial: boolean;
}) {
  const [marked, setMarked] = useState(initial);
  const [busy, setBusy] = useState(false);

  if (marked) {
    return (
      <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
        찍은 문제로 표시했어요
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        // 실패해도 되돌리지 않는다. 사용자가 할 수 있는 게 없고, 최악이 "간격이
        // 그대로 유지된다"라 되돌리는 쪽이 더 혼란스럽다.
        setMarked(true);
        await markReviewGuessed({ sessionId, position });
        setBusy(false);
      }}
      className="ml-auto rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-amber-900 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
    >
      찍었어요
    </button>
  );
}

// 채점 결과: 점수 + 문항별 정오/정답/출처 공개.
function ReviewResult({
  view,
  backHref,
  subjectSlug,
}: {
  view: ReviewSessionView;
  backHref: string;
  subjectSlug: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const correct = view.score ?? 0;
  const total = view.total;
  const wrong = total - correct;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  const items = useMemo(
    () => [...view.items].sort((a, b) => a.position - b.position),
    [view.items],
  );

  const wrongItems = items
    .filter((it) => it.isCorrect === false && it.paperId && it.questionNumber != null)
    .map((it) => ({ paperId: it.paperId as string, questionNumber: it.questionNumber as number }));

  function retryWrong() {
    if (pending || wrongItems.length === 0) return;
    setError(null);
    start(async () => {
      const res = await createReviewFromWrong({ items: wrongItems });
      if (res.error || !res.sessionId) {
        setError(res.error ?? "다시 풀기를 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${res.sessionId}`);
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full border-8 border-blue-600 border-r-zinc-200 dark:border-r-zinc-700">
          <span className="text-2xl font-bold">
            {correct}
            <span className="text-base text-zinc-400">/{total}</span>
          </span>
          <span className="text-xs text-zinc-500">정답률 {pct}%</span>
        </div>
        {/* 하나도 못 넘겼을 때 "🎉 0문항 극복"으로 조롱하지 않도록 톤을 나눈다. */}
        {correct > 0 ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
              🎉 {correct}문항 극복
            </span>
            {wrong > 0 && (
              <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/30 dark:text-red-400">
                {wrong}문항 아직
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            아직 못 넘겼어요. 해설을 보고 한 번 더 도전해요 💪
          </p>
        )}
      </div>

      {wrongItems.length > 0 && (
        <button
          type="button"
          onClick={retryWrong}
          disabled={pending}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          <RotateCcw size={16} />
          {pending ? "준비 중..." : `틀린 ${wrongItems.length}문항만 다시 풀기`}
        </button>
      )}
      {error && <p className="-mt-3 text-center text-xs text-red-600 dark:text-red-400">{error}</p>}

      {/* 채점 직후가 스케줄을 이해시키기 제일 좋은 자리다 — 방금 푼 문항이 각각
          언제 다시 오는지 본인 데이터로 보여준다. 무료 사용자에게는 아무것도 안 뜬다. */}
      <ReviewScheduleSection sessionId={view.id} />

      <Link
        href={backHref}
        className="block w-full rounded-xl bg-zinc-100 py-3 text-center text-sm font-bold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      >
        오답노트로 돌아가기
      </Link>

      <div className="flex flex-col gap-4">
        {items.map((it) => (
          <div
            key={it.position}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-xs dark:border-zinc-700 dark:bg-zinc-800/50">
              <span className="font-medium text-zinc-600 dark:text-zinc-400">
                {it.position + 1}번
                {it.paperTitle ? ` · ${it.paperTitle} ${it.questionNumber}번` : ""}
              </span>
              {it.isCorrect ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                  극복
                </span>
              ) : (
                <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700 dark:bg-red-950/30 dark:text-red-400">
                  오답
                </span>
              )}
            </div>
            {it.images.length > 0 && (
              <div className="flex flex-col">
                {it.images.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt={`${it.position + 1}번 이미지 ${i + 1}`} loading="lazy" className="w-full" />
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 px-4 py-3 dark:border-zinc-700">
              {Array.from({ length: it.choiceCount }, (_, c) => c + 1).map((choice) => {
                const isCorrect = it.correctChoice === choice;
                const isMyWrong = !isCorrect && it.selectedChoice === choice;
                return (
                  <span
                    key={choice}
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                      isCorrect
                        ? "bg-emerald-500 text-white"
                        : isMyWrong
                          ? "bg-red-500 text-white"
                          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
                    }`}
                  >
                    {choice}
                  </span>
                );
              })}
              {it.selectedChoice === null && (
                <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
                  풀지 않음
                </span>
              )}
              {/* 맞힌 문항에만. 찍어서 맞은 걸 유지력으로 인정하면 정작 모르는
                  문항이 "아는 문제"로 분류돼 복습에서 빠져나간다. */}
              {it.isCorrect && (
                <GuessedButton
                  sessionId={view.id}
                  position={it.position}
                  initial={it.guessed}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
