"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { getSubjectShortName, matchSubjectIds } from "@gongmoa/core";
import { SubjectBookmarkButton } from "@/components/subject-bookmark-button";
import type { Subject } from "@gongmoa/core";

// 홈에서 "즐겨찾기한 과목만 보기" 옆의 + 버튼으로 펼치는 과목 추가 패널.
// 과목 이름을 쳐서 찾고, 그 자리에서 별을 눌러 즐겨찾기에 넣고 뺀다.
export function SubjectQuickAdd({
  subjects,
  bookmarkedSubjectIds,
  loggedIn,
  onToggle,
}: {
  subjects: Subject[];
  bookmarkedSubjectIds: Set<string>;
  loggedIn: boolean;
  // 별을 누른 즉시 홈의 "즐겨찾기한 과목만 보기" 결과에도 반영되도록 부모에 알린다.
  onToggle: (subjectId: string, bookmarked: boolean) => void;
}) {
  const [query, setQuery] = useState("");

  // 홈 검색창과 같은 규칙(초성 검색·앞글자 우선)으로 찾아, 두 곳의 검색 결과가
  // 어긋나지 않게 한다. 검색어가 비어 있으면 전체 과목을 그대로 보여준다.
  const visibleSubjects = useMemo(() => {
    if (!query.trim()) return subjects;
    const ids = new Set(matchSubjectIds(subjects, query));
    return subjects.filter((s) => ids.has(s.id));
  }, [subjects, query]);

  return (
    <div className="w-full rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-zinc-400 dark:text-zinc-500"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="과목 이름으로 찾기 (예: 국어, ㄱㅇ)"
          className="w-full rounded-lg border border-zinc-200 py-2 pr-3 pl-9 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:focus:border-blue-600"
        />
      </div>

      {visibleSubjects.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
          찾는 과목이 없어요.
        </p>
      ) : (
        <div className="mt-3 grid max-h-64 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {visibleSubjects.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-1 rounded-lg border border-zinc-200 py-1 pl-3 pr-1.5 text-sm dark:border-zinc-700"
            >
              <span className="flex-1 truncate">{getSubjectShortName(s.name)}</span>
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
