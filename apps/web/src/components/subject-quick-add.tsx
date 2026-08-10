"use client";

import { useMemo, useState } from "react";
import { SubjectBookmarkButton } from "@/components/subject-bookmark-button";
import type { LightPaper } from "@/lib/paper-search";
import type { Subject } from "@gongmoa/core";

// 홈에서 "즐겨찾기한 과목만 보기" 옆의 + 버튼으로 펼치는 과목 추가 패널의 묶음.
//
// 급수(9·8·7·5급)는 exam_papers.level, 경찰·소방·계리는 level이 비어 있고
// 시행처(exam_types.name)로만 구분된다 — 그래서 두 기준을 한 목록에 섞어 둔다.
const GROUPS: { label: string; level?: string; examType?: string }[] = [
  { label: "9급", level: "9급" },
  { label: "8급", level: "8급" },
  { label: "7급", level: "7급" },
  { label: "5급", level: "5급" },
  { label: "경찰", examType: "경찰" },
  { label: "소방", examType: "소방" },
  { label: "계리직", examType: "계리직" },
];

export function SubjectQuickAdd({
  subjects,
  papers,
  bookmarkedSubjectIds,
  loggedIn,
  onToggle,
}: {
  subjects: Subject[];
  papers: LightPaper[];
  bookmarkedSubjectIds: Set<string>;
  loggedIn: boolean;
  // 별을 누른 즉시 홈의 "즐겨찾기한 과목만 보기" 결과에도 반영되도록 부모에 알린다.
  onToggle: (subjectId: string, bookmarked: boolean) => void;
}) {
  const [active, setActive] = useState(GROUPS[0].label);

  // 묶음별로 실제 자료가 있는 과목만 모은다. 과목 순서는 subjects 배열(=display_order)을
  // 그대로 따라가 다른 화면의 과목 나열 순서와 어긋나지 않게 한다.
  const subjectIdsByGroup = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const g of GROUPS) map.set(g.label, new Set<string>());
    for (const p of papers) {
      for (const g of GROUPS) {
        const hit = g.level ? p.level === g.level : p.exam_types?.name === g.examType;
        if (hit && p.subject_id) map.get(g.label)!.add(p.subject_id);
      }
    }
    return map;
  }, [papers]);

  const visibleSubjects = useMemo(() => {
    const ids = subjectIdsByGroup.get(active);
    if (!ids) return [];
    return subjects.filter((s) => ids.has(s.id));
  }, [subjects, subjectIdsByGroup, active]);

  return (
    <div className="w-full rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex flex-wrap gap-2">
        {GROUPS.map((g) => (
          <button
            key={g.label}
            type="button"
            onClick={() => setActive(g.label)}
            className={`rounded-full px-3.5 py-1 text-sm font-medium ${
              active === g.label
                ? "bg-zinc-800 text-white dark:bg-zinc-700"
                : "border border-zinc-200 text-zinc-600 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {visibleSubjects.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
          아직 등록된 자료가 없어요.
        </p>
      ) : (
        <div className="mt-3 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {visibleSubjects.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1 rounded-lg border border-zinc-200 py-1 pl-3 pr-1.5 text-sm dark:border-zinc-700"
            >
              <span className="flex-1 truncate">{s.name}</span>
              <SubjectBookmarkButton
                subjectId={s.id}
                initialBookmarked={bookmarkedSubjectIds.has(s.id)}
                loggedIn={loggedIn}
                size="sm"
                onToggled={(next) => onToggle(s.id, next)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
