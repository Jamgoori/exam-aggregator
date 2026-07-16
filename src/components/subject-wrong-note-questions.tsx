"use client";

import { useMemo, useState } from "react";
import {
  WrongNoteLegend,
  WrongNoteQuestionCard,
  type WrongNoteCardRow,
} from "@/components/wrong-note-question-card";
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
};

function comparator(sort: SortKey) {
  return (a: SubjectWrongNoteQuestion, b: SubjectWrongNoteQuestion): number => {
    if (sort === "recent") {
      const t = b.lastWrongAt.localeCompare(a.lastWrongAt);
      if (t !== 0) return t;
    } else if (sort === "frequent") {
      if (a.wrongCount !== b.wrongCount) return b.wrongCount - a.wrongCount;
      const t = b.lastWrongAt.localeCompare(a.lastWrongAt);
      if (t !== 0) return t;
    }
    return (
      a.paperTitle.localeCompare(b.paperTitle, "ko") ||
      a.questionNumber - b.questionNumber
    );
  };
}

// 과목 오답노트 "문항 모아보기" 탭 본문. 문제지 경계 없이 그 과목에서 틀린 문항을
// 한 목록으로 펼치고, 미극복/반복 오답 필터와 정렬을 서버 왕복 없이 즉시 적용한다.
export function SubjectWrongNoteQuestions({
  questions,
  unresolvedCount,
}: {
  questions: SubjectWrongNoteQuestion[];
  unresolvedCount: number;
}) {
  const [hideResolved, setHideResolved] = useState(false);
  const [onlyRepeated, setOnlyRepeated] = useState(false);
  const [sort, setSort] = useState<SortKey>("number");

  const cards = useMemo(() => {
    let list = questions;
    if (hideResolved) list = list.filter((q) => !q.resolved);
    if (onlyRepeated) list = list.filter((q) => q.wrongCount >= 2);
    const sorted = [...list].sort(comparator(sort));

    const out: Card[] = [];
    for (const q of sorted) {
      const last = out[out.length - 1];
      if (
        last &&
        last.paperId === q.paperId &&
        last.images.length > 0 &&
        q.images.length === last.images.length &&
        q.images.every((src, i) => src === last.images[i])
      ) {
        last.rows.push(toRow(q));
      } else {
        out.push({
          paperId: q.paperId,
          paperTitle: q.paperTitle,
          paperLevel: q.paperLevel,
          images: q.images,
          rows: [toRow(q)],
        });
      }
    }
    return out;
  }, [questions, hideResolved, onlyRepeated, sort]);

  const hasResolved = questions.some((q) => q.resolved);
  const hasRepeated = questions.some((q) => q.wrongCount >= 2);

  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${
      active
        ? "bg-blue-600 text-white"
        : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
    }`;

  return (
    <div className="flex flex-col gap-4">
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
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="ml-auto shrink-0 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
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
          {hideResolved || onlyRepeated
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
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
