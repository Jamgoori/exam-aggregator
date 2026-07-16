"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import {
  submitReviewSession,
  createReviewFromWrong,
} from "@/app/mypage/wrong-notes/actions";
import type { ReviewItemView, ReviewSessionView } from "@/lib/review-session";

// 섞어풀기 풀이 화면. 문제지 경계 없이 섞인 오답을 순서대로 풀고 채점한다. 풀이
// 중에는 출처(문제지·번호)와 정답을 숨겨 힌트가 되지 않게 하고, 채점 후에만 공개한다.
// CBT 솔버(PDF·필기·최소응시시간)와 달리 순수 문항 리스트라 가볍게 따로 뒀다.
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
  const [answers, setAnswers] = useState<(number | null)[]>(
    Array(initial.total).fill(null),
  );
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submitted = view.submitted;
  const answeredCount = answers.filter((a) => a !== null).length;

  // 채점 전 답은 클라이언트 상태로만 있어 페이지를 벗어나면 사라진다. 새로고침·닫기는
  // beforeunload로, 뒤로가기 링크는 클릭 확인으로 막는다(하나라도 풀었을 때만).
  const dirty = !submitted && answeredCount > 0;
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
      !window.confirm("지금 나가면 푼 답이 사라져요. 그래도 나갈까요?")
    ) {
      e.preventDefault();
    }
  }

  if (submitted) {
    return <ReviewResult view={view} backHref={backHref} subjectSlug={subjectSlug} />;
  }

  // 방어: 문항이 하나도 없는 세션(데이터 손상 등)에서 view.items[0] 접근이 터지지 않게.
  if (view.items.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 py-16 text-center">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          풀 수 있는 문항이 없어요. 오답노트로 돌아가 다시 시도해주세요.
        </p>
        <Link
          href={backHref}
          className="rounded-xl bg-zinc-100 px-5 py-2.5 text-sm font-bold text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          오답노트로 돌아가기
        </Link>
      </div>
    );
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
      setView(res.view);
    });
  }

  return (
    <div className="flex h-[100dvh] flex-col lg:h-[calc(100dvh-65px)]">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
        <Link
          href={backHref}
          aria-label="나가기"
          onClick={confirmLeave}
          className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <ChevronLeft size={20} />
        </Link>
        <h1 className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
          섞어풀기{view.subjectName ? ` · ${view.subjectName}` : ""}
        </h1>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-zinc-500 dark:text-zinc-400">
          {index + 1} / {view.total}
        </span>
      </header>

      {/* 진행도 */}
      <div className="h-1 shrink-0 bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full bg-blue-600 transition-[width]"
          style={{ width: `${((index + 1) / view.total) * 100}%` }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-100 px-4 py-4 dark:bg-zinc-800">
        <div className="mx-auto flex max-w-2xl flex-col gap-2 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          {item.images.length === 0 ? (
            <p className="py-24 text-center text-sm text-zinc-400 dark:text-zinc-600">
              이 문제의 이미지가 없어요.
            </p>
          ) : (
            item.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt={`문제 ${index + 1} 이미지 ${i + 1}`} className="w-full" />
            ))
          )}
        </div>
        <p className="mx-auto mt-3 max-w-2xl text-center text-xs text-zinc-400 dark:text-zinc-600">
          출처와 정답은 채점 후에 공개돼요.
        </p>
      </div>

      <div className="shrink-0 border-t border-zinc-200 bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-900">
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
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
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
              onClick={() => setIndex((i) => Math.min(view.items.length - 1, i + 1))}
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

// 한 세션에 담기는 최대 문항 수(서버 review-session.ts의 MAX_LIMIT와 맞춰둔 값).
// 이보다 많이 골라도 서버가 잘라내므로, 골라둔 수가 이를 넘으면 미리 알려준다.
const REVIEW_MAX_ITEMS = 50;

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

  // 다시 풀기 후보(출처가 있는 문항 전체 — 극복/오답 무관). 체크박스로 문항별
  // 포함 여부를 고르고, 기본값은 "틀린 것만"으로 맞춰 기존 동작을 그대로 유지한다.
  const retryable = items.filter(
    (it) => it.paperId && it.questionNumber != null,
  ) as (ReviewItemView & { paperId: string; questionNumber: number })[];
  const wrongItems = retryable.filter((it) => it.isCorrect === false);

  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(wrongItems.map((it) => it.position)),
  );

  function toggle(position: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(position)) next.delete(position);
      else next.add(position);
      return next;
    });
  }

  function retrySelected() {
    if (pending || selected.size === 0) return;
    setError(null);
    const chosen = retryable
      .filter((it) => selected.has(it.position))
      .map((it) => ({ paperId: it.paperId, questionNumber: it.questionNumber }));
    start(async () => {
      const res = await createReviewFromWrong({ items: chosen });
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

      {retryable.length > 0 && (
        <div className="flex flex-col gap-2">
          {/* 극복한 문항도 다시 풀고 싶을 수 있어, 문항 카드 체크박스로 개별 선택하거나
              아래 프리셋으로 한 번에 고를 수 있게 한다. 기본 선택은 "틀린 것만"이라
              바로 눌러도 예전과 동일하게 동작한다. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
            <span>다시 풀 문항 고르기:</span>
            <button
              type="button"
              onClick={() => setSelected(new Set(wrongItems.map((it) => it.position)))}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              틀린 것만
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set(retryable.map((it) => it.position)))}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              극복 포함 전체
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              선택 해제
            </button>
          </div>
          {selected.size > REVIEW_MAX_ITEMS && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              한 번에 최대 {REVIEW_MAX_ITEMS}문항까지 풀 수 있어, {REVIEW_MAX_ITEMS}문항만
              무작위로 담겨요.
            </p>
          )}
          <button
            type="button"
            onClick={retrySelected}
            disabled={pending || selected.size === 0}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RotateCcw size={16} />
            {pending
              ? "준비 중..."
              : selected.size > 0
                ? `선택한 ${Math.min(selected.size, REVIEW_MAX_ITEMS)}문항 다시 풀기`
                : "다시 풀 문항을 선택하세요"}
          </button>
        </div>
      )}
      {error && <p className="-mt-3 text-center text-xs text-red-600 dark:text-red-400">{error}</p>}

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
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-800/50">
              <span className="flex items-center gap-2 font-medium text-zinc-600 dark:text-zinc-400">
                {it.paperId && it.questionNumber != null && (
                  <input
                    type="checkbox"
                    checked={selected.has(it.position)}
                    onChange={() => toggle(it.position)}
                    aria-label="다시 풀기에 포함"
                    className="h-3.5 w-3.5 accent-blue-600"
                  />
                )}
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
            <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
