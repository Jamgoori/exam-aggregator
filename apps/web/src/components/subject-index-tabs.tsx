"use client";

import { useState } from "react";
import Link from "next/link";
import { CONSONANTS, initialConsonant } from "@gongmoa/core";
import { SubjectBookmarkButton } from "@/components/subject-bookmark-button";
import type { Subject } from "@gongmoa/core";

export function SubjectIndexTabs({
  subjects,
  bookmarkedSubjectIds = new Set(),
  loggedIn = false,
  onToggle,
}: {
  subjects: Subject[];
  // 로그인한 사용자가 즐겨찾기한 과목 id들 (별 아이콘 초기 상태 표시용)
  bookmarkedSubjectIds?: Set<string>;
  loggedIn?: boolean;
  // 홈처럼 즐겨찾기 상태로 목록을 거르는 화면이 곧바로 따라가기 위한 알림.
  onToggle?: (subjectId: string, bookmarked: boolean) => void;
}) {
  const [active, setActive] = useState<string | null>(null);

  const filtered = active
    ? subjects.filter((s) => initialConsonant(s.name) === active)
    : [];

  return (
    <>
      {/* 모바일에서는 원형 버튼 14개가 두 줄로 쌓여 첫 화면에서 카드 목록을 밀어내던
          것을, 옆으로 스와이프하는 한 줄로 압축한다(스크롤바는 숨김). 폭이 넉넉한
          sm 이상에서는 기존처럼 전부 펼쳐 보여준다. */}
      <div className="flex gap-x-2 overflow-x-auto border-t border-zinc-100 pt-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:gap-x-3 sm:gap-y-2 sm:overflow-visible sm:pb-0 dark:border-zinc-700">
        {CONSONANTS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setActive(c)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-sm font-medium text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:bg-blue-950/40 dark:hover:text-blue-400"
          >
            {c}
          </button>
        ))}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setActive(null)}
        >
          <div
            className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">&apos;{active}&apos; 과목</h3>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="text-sm text-zinc-400 dark:text-zinc-600"
              >
                닫기
              </button>
            </div>
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
                해당하는 과목이 없어요.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filtered.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-1 rounded-lg border border-zinc-200 pl-3 pr-1.5 py-1 text-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:hover:border-blue-700 dark:hover:bg-blue-950/40 dark:hover:text-blue-400"
                  >
                    <Link
                      href={`/subjects/${s.slug}`}
                      onClick={() => setActive(null)}
                      className="flex-1 py-1 text-center"
                    >
                      {s.name}
                    </Link>
                    <SubjectBookmarkButton
                      subjectId={s.id}
                      initialBookmarked={bookmarkedSubjectIds.has(s.id)}
                      loggedIn={loggedIn}
                      size="sm"
                      onToggled={(next) => onToggle?.(s.id, next)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
