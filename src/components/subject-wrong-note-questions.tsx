"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Shuffle } from "lucide-react";
import {
  WrongNoteLegend,
  WrongNoteQuestionCard,
  type WrongNoteCardRow,
} from "@/components/wrong-note-question-card";
import { createReviewSession } from "@/app/mypage/wrong-notes/actions";
import { MemoEditor } from "@/components/memo-editor";
import { levelColor } from "@/lib/level-colors";
import type { SubjectWrongNoteQuestion } from "@/lib/wrong-notes";

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
  initialConcept,
}: {
  questions: SubjectWrongNoteQuestion[];
  unresolvedCount: number;
  subjectSlug: string;
  // 진단 리포트에서 "이 개념 틀린 문항 모아보기"로 들어오면 그 개념으로 미리 필터.
  initialConcept?: string;
}) {
  const router = useRouter();

  // 문항에 붙은 해설의 핵심 개념(keyword_title)으로 개념 목록을 만든다. 별도 조회 없이
  // 이미 받은 explanation에서 뽑는다. 진단 딥링크의 개념이 목록에 있으면 초기값으로.
  const concepts = useMemo(() => {
    const set = new Set<string>();
    for (const q of questions) {
      const k = q.explanation?.keywordTitle?.trim();
      if (k) set.add(k);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [questions]);

  const [hideResolved, setHideResolved] = useState(false);
  const [onlyRepeated, setOnlyRepeated] = useState(false);
  const [concept, setConcept] = useState<string>(
    initialConcept && concepts.includes(initialConcept) ? initialConcept : "all",
  );
  const [sort, setSort] = useState<SortKey>("number");
  const [reviewPending, startReview] = useTransition();
  const [reviewError, setReviewError] = useState<string | null>(null);

  // 이미지가 있어 실제로 풀 수 있는 미극복 오답만 섞어풀기 대상이 된다(서버도 같은
  // 기준으로 거른다). 0개면 버튼을 숨긴다.
  const playableUnresolved = useMemo(
    () => questions.filter((q) => !q.resolved && q.images.length > 0).length,
    [questions],
  );

  function startShuffle() {
    if (reviewPending) return;
    setReviewError(null);
    startReview(async () => {
      const res = await createReviewSession({ subjectSlug, onlyUnresolved: true });
      if (res.error || !res.sessionId) {
        setReviewError(res.error ?? "섞어풀기를 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/${subjectSlug}/review/${res.sessionId}`);
    });
  }

  const cards = useMemo(() => {
    let list = questions;
    if (hideResolved) list = list.filter((q) => !q.resolved);
    if (onlyRepeated) list = list.filter((q) => q.wrongCount >= 2);
    if (concept !== "all")
      list = list.filter((q) => q.explanation?.keywordTitle?.trim() === concept);

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
  }, [questions, hideResolved, onlyRepeated, concept, sort]);

  const hasResolved = questions.some((q) => q.resolved);
  const hasRepeated = questions.some((q) => q.wrongCount >= 2);

  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${
      active
        ? "bg-blue-600 text-white"
        : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
    }`;

  const conceptMissing =
    !!initialConcept && concepts.length > 0 && !concepts.includes(initialConcept);

  return (
    <div className="flex flex-col gap-4">
      {conceptMissing && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
          &lsquo;{initialConcept}&rsquo; 개념으로 좁히지 못해 전체 문항을 보여드려요.
        </p>
      )}

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
              ? "섞는 중..."
              : `섞어풀기 — 미극복 ${playableUnresolved}문항 · 순서 섞기`}
          </button>
          {reviewError && (
            <p className="text-center text-xs text-red-600 dark:text-red-400">{reviewError}</p>
          )}
        </div>
      ) : (
        // 미극복은 있는데 이미지가 없어 섞어풀기를 못 여는 경우, 버튼이 그냥 사라져
        // 혼란스럽지 않게 이유를 알려준다.
        unresolvedCount > 0 && (
          <p className="rounded-xl border border-zinc-200 px-3 py-2.5 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
            아직 문제 이미지가 등록된 미극복 문항이 없어 섞어풀기를 준비 중이에요.
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
          미극복만
        </button>
        <button
          type="button"
          onClick={() => setOnlyRepeated((v) => !v)}
          disabled={!hasRepeated}
          className={`${chip(onlyRepeated)} disabled:cursor-not-allowed disabled:opacity-40`}
        >
          2번 이상 틀림
        </button>
        {concepts.length > 0 && (
          <select
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            className="shrink-0 rounded-full border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
          >
            <option value="all">개념: 전체</option>
            {concepts.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="shrink-0 rounded-full border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
        >
          {SORT_LABELS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        이 과목에서 틀린 문항을 문제지 구분 없이 모았어요. 답 표시는 가장 최근에
        틀렸을 때 기준이에요. 전체 오답 {questions.length}개 · 미극복 {unresolvedCount}개.
      </p>

      {cards.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-500">
          {hideResolved || onlyRepeated || concept !== "all"
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
                <WrongNoteQuestionCard rows={card.rows} images={card.images} />
                <div className="flex flex-col divide-y divide-zinc-100 rounded-xl border border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800/70">
                  {card.source.map((q) => (
                    <MemoEditor
                      key={q.questionNumber}
                      paperId={q.paperId}
                      questionNumber={q.questionNumber}
                      initialMemo={q.memo}
                      label={card.source.length > 1 ? `${q.questionNumber}번` : undefined}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
