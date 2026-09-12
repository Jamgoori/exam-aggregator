"use client";

import { useState } from "react";
import Link from "next/link";
import { CONSONANTS, initialConsonant } from "@gongmoa/core";
import { SubjectBookmarkButton } from "@/components/subject-bookmark-button";
import {
  KHE_TAB_LABEL,
  kheHref,
  withoutKheSubject,
} from "@/lib/korean-history-exam";
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

  // 한능검 전용 과목은 초성 목록에서 뺀다 — 바로 옆에 전용 탭이 있고, 두 군데에
  // 보이면 ㅎ 탭에 "한국사"와 "한국사능력검정시험"이 나란히 떠 헷갈린다
  // (lib/korean-history-exam.ts).
  const filtered = active
    ? withoutKheSubject(subjects).filter(
        (s) => initialConsonant(s.name) === active,
      )
    : [];

  return (
    <>
      {/* 모바일에서는 원형 버튼 14개가 두 줄로 쌓여 첫 화면에서 카드 목록을 밀어내던
          것을, 옆으로 스와이프하는 한 줄로 압축한다(스크롤바는 숨김). 폭이 넉넉한
          sm 이상에서는 기존처럼 전부 펼쳐 보여준다. */}
      <div className="flex gap-x-2 overflow-x-auto border-t border-zinc-100 pt-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:gap-x-3 sm:gap-y-2 sm:overflow-visible sm:pb-0 dark:border-zinc-700">
        {/* 한능검 탭. 공무원 과목이 아니라 시험 하나라서 초성 자리가 없고, 모달로
            과목을 고를 것도 없다 — 눌리면 곧장 한능검 시험 페이지로 간다. 초성 원형
            버튼들과 같은 색·높이를 유지하되 글자 수만큼 넓은 알약 모양으로 두어, 맨 앞의
            이 하나만 성격이 다르다는 것이 모양으로만 드러나게 한다 — 색을 채워 두면
            아무것도 고르지 않았는데 이 탭이 켜져 있는 것처럼 보인다. */}
        <Link
          href={kheHref()}
          className="flex h-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-zinc-700 dark:bg-transparent dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:bg-blue-950/40 dark:hover:text-blue-400"
        >
          {KHE_TAB_LABEL}
        </Link>
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
