"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shuffle } from "lucide-react";
import {
  WrongNoteLegend,
  WrongNoteQuestionCard,
  type WrongNoteCardRow,
} from "@/components/wrong-note-question-card";
import {
  createReviewSession,
  createReviewFromWrong,
} from "@/app/mypage/wrong-notes/actions";
import { MemoEditor } from "@/components/memo-editor";
import {
  WrongNoteMarkActions,
  WrongNoteUndoToast,
} from "@/components/wrong-note-mark-actions";
import { levelColor } from "@/lib/level-colors";
import type { SubjectWrongNoteQuestion } from "@/lib/wrong-notes";
import type { ReviewPickStrategy } from "@gongmoa/core";

type SortKey = "number" | "recent" | "frequent";

const SORT_LABELS: { key: SortKey; label: string }[] = [
  { key: "number", label: "문제지·번호순" },
  { key: "recent", label: "최근 틀린 순" },
  { key: "frequent", label: "자주 틀린 순" },
];

function toRow(q: SubjectWrongNoteQuestion): WrongNoteCardRow {
  return {
    questionNumber: q.questionNumber,
    selectedChoice: q.selectedChoice,
    correctChoice: q.correctChoice,
    choiceCount: q.choiceCount,
    explanation: q.explanation,
    explanationLocked: q.explanationLocked,
    wrongCount: q.wrongCount,
    resolved: q.resolved,
    wrongRatePct: q.wrongRatePct,
  };
}

// 같은 이미지 배열이 연속되면(같은 문제지의 세트문제) 카드 하나로 묶는다. 다른
// 문제지끼리는 이미지 경로가 겹칠 일이 없어 자연히 분리된다.
type Card = {
  paperId: string;
  paperTitle: string;
  paperLevel: string | null;
  images: string[];
  rows: WrongNoteCardRow[];
  // 메모 등 문항 원본이 필요한 UI용(카드 아래 메모 입력).
  source: SubjectWrongNoteQuestion[];
};

// 과목 오답노트 "문항 모아보기" 탭 본문. 문제지 경계 없이 그 과목에서 틀린 문항을
// 한 목록으로 펼치고, 미극복/반복 오답 필터와 정렬을 서버 왕복 없이 즉시 적용한다.
export function SubjectWrongNoteQuestions({
  questions,
  unresolvedCount,
  subjectSlug,
}: {
  questions: SubjectWrongNoteQuestion[];
  unresolvedCount: number;
  subjectSlug: string;
}) {
  const router = useRouter();

  const [hideResolved, setHideResolved] = useState(false);
  const [onlyRepeated, setOnlyRepeated] = useState(false);
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [sort, setSort] = useState<SortKey>("number");
  const [reviewPending, startReview] = useTransition();
  const [reviewError, setReviewError] = useState<string | null>(null);
  // 섞어풀기가 후보를 뽑는 방식. 기본은 층 정원제(2번 이상 틀림 > 최근 오답 > 나머지).
  // 오답이 수백 개 쌓이면 균등 무작위는 위험한 문항을 만날 확률을 계속 희석시킨다.
  const [strategy, setStrategy] = useState<ReviewPickStrategy>("weighted");

  // 다시보기 체크/완전 삭제는 서버 왕복 없이 즉시 반영한다. 키는 `${paperId}#${qnum}`.
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(
    () => new Set(questions.filter((q) => q.pinned).map((q) => `${q.paperId}#${q.questionNumber}`)),
  );
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
  // 마지막으로 삭제한 문항 — 되돌리기 토스트용.
  const [lastDeleted, setLastDeleted] = useState<{
    key: string;
    paperId: string;
    questionNumber: number;
  } | null>(null);

  // 삭제된 문항을 뺀 "지금 화면의 전체 목록". 카운트·필터·섞어풀기 후보가 전부
  // 이 목록 기준이라 삭제가 숫자에도 바로 반영된다.
  const visible = useMemo(
    () => questions.filter((q) => !deletedKeys.has(`${q.paperId}#${q.questionNumber}`)),
    [questions, deletedKeys],
  );
  const visibleUnresolved = useMemo(() => {
    const removedUnresolved = questions.filter(
      (q) => !q.resolved && deletedKeys.has(`${q.paperId}#${q.questionNumber}`),
    ).length;
    return Math.max(0, unresolvedCount - removedUnresolved);
  }, [questions, deletedKeys, unresolvedCount]);

  // 문항 선택 → 선택한 것만 섞어풀기. 극복한 문항도 목록에 뜨므로(미극복만 필터 끄면)
  // 골라서 다시 풀 수 있다. 키는 `${paperId}#${questionNumber}`.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selPending, startSel] = useTransition();
  const [selError, setSelError] = useState<string | null>(null);

  function toggleSelect(paperId: string, questionNumber: number) {
    const key = `${paperId}#${questionNumber}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function startSelected() {
    if (selPending || selected.size === 0) return;
    setSelError(null);
    const items = [...selected].map((k) => {
      const idx = k.lastIndexOf("#");
      return { paperId: k.slice(0, idx), questionNumber: Number(k.slice(idx + 1)) };
    });
    startSel(async () => {
      const res = await createReviewFromWrong({ items });
      if (res.error || !res.sessionId) {
        setSelError(res.error ?? "다시 풀기를 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${res.sessionId}`);
    });
  }

  // 이미지가 있어 실제로 풀 수 있는 미극복 오답만 섞어풀기 대상이 된다(서버도 같은
  // 기준으로 거른다). 0개면 버튼을 숨긴다.
  const playableUnresolved = useMemo(
    () => visible.filter((q) => !q.resolved && q.images.length > 0).length,
    [visible],
  );

  function startShuffle() {
    if (reviewPending) return;
    setReviewError(null);
    startReview(async () => {
      const res = await createReviewSession({ subjectSlug, onlyUnresolved: true, strategy });
      if (res.error || !res.sessionId) {
        setReviewError(res.error ?? "다시 풀기를 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${res.sessionId}`);
    });
  }

  const cards = useMemo(() => {
    let list = visible;
    if (hideResolved) list = list.filter((q) => !q.resolved);
    if (onlyRepeated) list = list.filter((q) => q.wrongCount >= 2);
    if (onlyPinned)
      list = list.filter((q) => pinnedKeys.has(`${q.paperId}#${q.questionNumber}`));

    // 먼저 세트문제(같은 문제지 + 동일 이미지 배열)를 한 그룹으로 묶은 뒤 그룹 단위로
    // 정렬한다. 문항 단위로 정렬하면 "최근/자주 틀린 순"에서 세트 구성원이 흩어져
    // 같은 지문 이미지가 여러 카드로 중복 렌더되던 문제를 막는다.
    const groupMap = new Map<string, SubjectWrongNoteQuestion[]>();
    const order: string[] = [];
    for (const q of list) {
      const sig =
        q.images.length > 0
          ? `${q.paperId}|${q.images.join("")}`
          : `${q.paperId}|solo|${q.questionNumber}`;
      const arr = groupMap.get(sig);
      if (arr) arr.push(q);
      else {
        groupMap.set(sig, [q]);
        order.push(sig);
      }
    }

    // 각 그룹의 정렬 키: number는 (제목,최소번호), recent는 그룹 내 가장 최근,
    // frequent는 그룹 내 최다 오답. 그룹 대표값으로 그룹끼리 정렬한다.
    const groups = order.map((sig) => {
      const qs = groupMap.get(sig)!.sort((a, b) => a.questionNumber - b.questionNumber);
      const head = qs[0];
      return {
        card: {
          paperId: head.paperId,
          paperTitle: head.paperTitle,
          paperLevel: head.paperLevel,
          images: head.images,
          rows: qs.map(toRow),
          source: qs,
        } as Card,
        recentAt: qs.reduce((m, q) => (q.lastWrongAt > m ? q.lastWrongAt : m), qs[0].lastWrongAt),
        maxWrong: qs.reduce((m, q) => Math.max(m, q.wrongCount), 0),
        title: head.paperTitle,
        minNumber: head.questionNumber,
      };
    });

    groups.sort((a, b) => {
      if (sort === "recent") {
        const t = b.recentAt.localeCompare(a.recentAt);
        if (t !== 0) return t;
      } else if (sort === "frequent") {
        if (a.maxWrong !== b.maxWrong) return b.maxWrong - a.maxWrong;
        const t = b.recentAt.localeCompare(a.recentAt);
        if (t !== 0) return t;
      }
      return a.title.localeCompare(b.title, "ko") || a.minNumber - b.minNumber;
    });

    return groups.map((g) => g.card);
  }, [visible, hideResolved, onlyRepeated, onlyPinned, pinnedKeys, sort]);

  const hasResolved = visible.some((q) => q.resolved);
  const hasRepeated = visible.some((q) => q.wrongCount >= 2);
  const hasPinned = pinnedKeys.size > 0;

  function markPinned(key: string, pinned: boolean) {
    setPinnedKeys((prev) => {
      const next = new Set(prev);
      if (pinned) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${
      active
        ? "bg-blue-600 text-white"
        : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
    }`;

  // 해설 잠금 카드가 결제 후 돌아올 곳(무료 회원 화면에서만 쓰인다).
  const lockNext = `/mypage/wrong-notes/${subjectSlug}?view=questions`;

  return (
    <div className={`flex flex-col gap-4 ${selected.size > 0 ? "pb-24" : ""}`}>
      {playableUnresolved > 0 ? (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={startShuffle}
            disabled={reviewPending}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Shuffle size={16} />
            {reviewPending
              ? "준비 중..."
              : `남은 오답 ${playableUnresolved}개 섞어서 다시 풀기`}
          </button>
          {/* 뽑는 방식은 설정 화면이 아니라 버튼 바로 아래에 둔다 — 이 버튼이
              무엇을 하는지의 일부라서 따로 찾아 들어갈 성질이 아니다. */}
          <div className="flex items-center justify-center gap-1.5">
            <PickChip
              label="약한 문제 우선"
              active={strategy === "weighted"}
              onClick={() => setStrategy("weighted")}
            />
            <PickChip
              label="전체 랜덤"
              active={strategy === "random"}
              onClick={() => setStrategy("random")}
            />
          </div>
          <p className="text-center text-[11px] text-zinc-500 dark:text-zinc-500">
            {strategy === "weighted"
              ? "2번 이상 틀린 문제를 많이, 오래된 오답도 조금 섞어서 내요."
              : "남은 오답 전체에서 똑같은 확률로 뽑아요."}
          </p>
          {reviewError && (
            <p className="text-center text-xs text-red-600 dark:text-red-400">{reviewError}</p>
          )}
        </div>
      ) : (
        // 미극복은 있는데 이미지가 없어 섞어풀기를 못 여는 경우, 버튼이 그냥 사라져
        // 혼란스럽지 않게 이유를 알려준다.
        visibleUnresolved > 0 && (
          <p className="rounded-xl border border-zinc-200 px-3 py-2.5 text-center text-xs text-zinc-500 dark:border-zinc-700 dark:text-zinc-500">
            아직 문제 이미지가 등록된 오답이 없어 다시 풀기를 준비 중이에요.
          </p>
        )
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setHideResolved((v) => !v)}
          disabled={!hasResolved}
          className={`${chip(hideResolved)} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          남은 오답만
        </button>
        <button
          type="button"
          onClick={() => setOnlyRepeated((v) => !v)}
          disabled={!hasRepeated}
          className={`${chip(onlyRepeated)} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          2번 이상 틀림
        </button>
        <button
          type="button"
          onClick={() => setOnlyPinned((v) => !v)}
          disabled={!hasPinned && !onlyPinned}
          className={`${chip(onlyPinned)} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          다시 볼 문제만
        </button>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="shrink-0 rounded-full border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
        >
          {SORT_LABELS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        이 과목에서 틀린 문제를 시험지 구분 없이 모았어요. 답 표시는 가장 최근에
        틀렸을 때 기준이에요. 전체 오답 {visible.length}개 · 남은 오답 {visibleUnresolved}개.
      </p>

      {cards.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-500">
          {hideResolved || onlyRepeated || onlyPinned
            ? "이 조건에 맞는 문항이 없어요. 필터를 바꿔보세요."
            : "이 과목에서는 아직 틀린 문제가 없어요. CBT로 문제를 풀면 틀린 문제가 자동으로 모여요."}
        </p>
      ) : (
        <>
          <WrongNoteLegend />
          <div className="flex flex-col gap-5">
            {cards.map((card, i) => (
              <div key={`${sort}-${card.paperId}-${card.rows[0].questionNumber}-${i}`} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-500">
                  {card.paperLevel && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${levelColor(card.paperLevel)}`}
                    >
                      {card.paperLevel}
                    </span>
                  )}
                  <span className="font-medium text-zinc-600 dark:text-zinc-400">
                    {card.paperTitle}
                  </span>
                </div>
                <WrongNoteQuestionCard
                  rows={card.rows}
                  images={card.images}
                  explanationLockNext={lockNext}
                  paperId={card.paperId}
                  reportContext="explanation"
                  renderRowActions={(questionNumber) => {
                    const key = `${card.paperId}#${questionNumber}`;
                    return (
                      <WrongNoteMarkActions
                        paperId={card.paperId}
                        questionNumber={questionNumber}
                        pinned={pinnedKeys.has(key)}
                        onPinnedChange={(p) => markPinned(key, p)}
                        onDeleted={() => {
                          setDeletedKeys((prev) => new Set(prev).add(key));
                          setLastDeleted({
                            key,
                            paperId: card.paperId,
                            questionNumber,
                          });
                        }}
                      />
                    );
                  }}
                />
                <div className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-100 dark:divide-zinc-700 dark:border-zinc-700/70">
                  {card.source.map((q) => {
                    const key = `${q.paperId}#${q.questionNumber}`;
                    return (
                      <div key={q.questionNumber} className="flex items-start gap-1">
                        <label className="flex shrink-0 cursor-pointer items-center gap-1 py-2 pl-2 text-xs text-zinc-500 dark:text-zinc-400">
                          <input
                            type="checkbox"
                            checked={selected.has(key)}
                            onChange={() => toggleSelect(q.paperId, q.questionNumber)}
                            className="h-4 w-4 accent-blue-600"
                          />
                          <span className="select-none">선택</span>
                        </label>
                        <div className="min-w-0 flex-1">
                          <MemoEditor
                            paperId={q.paperId}
                            questionNumber={q.questionNumber}
                            initialMemo={q.memo}
                            label={card.source.length > 1 ? `${q.questionNumber}번` : undefined}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* 문항을 고르면 뜨는 하단 바: 선택한 것(극복 포함)만 섞어풀기. */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="flex w-full max-w-md items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="shrink-0 rounded-lg px-3 py-2 text-sm font-medium text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              해제
            </button>
            <button
              type="button"
              onClick={startSelected}
              disabled={selPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <Shuffle size={15} />
              {selPending ? "준비 중..." : `선택한 ${selected.size}개 다시 풀기`}
            </button>
          </div>
        </div>
      )}
      {selError && (
        <p className="fixed inset-x-0 bottom-20 z-30 text-center text-xs text-red-600 dark:text-red-400">
          {selError}
        </p>
      )}

      {lastDeleted && (
        <WrongNoteUndoToast
          key={lastDeleted.key}
          paperId={lastDeleted.paperId}
          questionNumber={lastDeleted.questionNumber}
          bottomClass={selected.size > 0 ? "bottom-[4.5rem]" : "bottom-4"}
          onRestored={() => {
            setDeletedKeys((prev) => {
              const next = new Set(prev);
              next.delete(lastDeleted.key);
              return next;
            });
            setLastDeleted(null);
          }}
          onDismiss={() => setLastDeleted(null)}
        />
      )}
    </div>
  );
}

// 섞어풀기 뽑기 방식 칩. 필터 칩(chip)보다 한 단계 작게 둬서 "필터가 하나 더
// 늘었다"로 읽히지 않게 한다 — 목록을 거르는 게 아니라 버튼의 동작을 고르는 자리다.
function PickChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
          : "text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
      }`}
    >
      {label}
    </button>
  );
}
