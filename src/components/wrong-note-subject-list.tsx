"use client";

import { useState } from "react";
import Link from "next/link";
import { Monitor } from "lucide-react";
import {
  WrongNoteQuestionCard,
  type WrongNoteCardRow,
} from "@/components/wrong-note-question-card";
import { levelColor } from "@/lib/level-colors";

export type WrongNoteListPaper = {
  paperId: string;
  title: string;
  level: string | null;
  attemptCount: number;
  unresolvedCount: number;
  resolvedCount: number;
  // 세트문제 묶음까지 서버에서 미리 계산해서 넘겨받는다 (카드 1장 = 원소 1개).
  groups: { images: string[]; rows: WrongNoteCardRow[] }[];
};

type FilterKey = "all" | "unresolved";

// 과목 오답노트의 본문 목록. "전체 / 아직 틀리는 문제만" 필터가 서버 왕복 없이
// 즉시 바뀌어야 해서 클라이언트 컴포넌트로 뒀다 (마이페이지 탭과 같은 이유).
export function WrongNoteSubjectList({ papers }: { papers: WrongNoteListPaper[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const totalUnresolved = papers.reduce((sum, p) => sum + p.unresolvedCount, 0);
  const totalAll = papers.reduce(
    (sum, p) => sum + p.unresolvedCount + p.resolvedCount,
    0,
  );

  const filters: { key: FilterKey; label: string }[] = [
    { key: "all", label: `전체 (${totalAll})` },
    { key: "unresolved", label: `아직 틀리는 문제만 (${totalUnresolved})` },
  ];

  const visiblePapers = papers
    .map((p) => {
      if (filter === "all") return p;
      const groups = p.groups
        .map((g) => ({ ...g, rows: g.rows.filter((r) => !r.resolved) }))
        .filter((g) => g.rows.length > 0);
      return { ...p, groups };
    })
    .filter((p) => p.groups.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              filter === f.key
                ? "bg-blue-600 text-white"
                : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visiblePapers.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          아직 틀리는 문제가 없어요. 모든 오답을 극복했어요! 🎉
        </p>
      ) : (
        visiblePapers.map((p) => (
          <section
            key={p.paperId}
            id={`paper-${p.paperId}`}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              {p.level && (
                <span
                  className={`rounded px-2 py-0.5 text-xs font-bold ${levelColor(p.level)}`}
                >
                  {p.level}
                </span>
              )}
              <Link
                href={`/papers/${p.paperId}`}
                className="font-medium leading-snug hover:text-blue-600"
              >
                {p.title}
              </Link>
              <span className="text-xs text-zinc-400">
                {p.attemptCount}회 응시 · 오답 {p.unresolvedCount}
                {p.resolvedCount > 0 && ` · 극복 ${p.resolvedCount}`}
              </span>
              <Link
                href={`/papers/${p.paperId}/cbt`}
                className="ml-auto flex shrink-0 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                <Monitor size={12} />
                다시 풀기
              </Link>
            </div>

            <div className="flex flex-col gap-4">
              {p.groups.map((group) => (
                <WrongNoteQuestionCard
                  key={group.rows[0].questionNumber}
                  rows={group.rows}
                  images={group.images}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
