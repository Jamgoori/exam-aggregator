"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { matchSubjectIds, type Subject } from "@gongmoa/core";
import { subjectColor } from "@/lib/subject-colors";

export type MixPickerSubject = {
  slug: string;
  name: string;
  // 고른 급수 기준 수(급수를 안 골랐으면 과목 전체). 단위는 unit 이 정한다.
  count: number;
  favorite: boolean;
};

// 섞어풀기 허브의 과목 고르기. 자료가 있는 과목이 수십 개라 목록만 두면 스크롤로
// 찾아야 해서, 검색창을 함께 둔다.
//
// 매칭 규칙은 사이트 검색과 같은 함수(@gongmoa/core 의 matchSubjectIds)를 쓴다 —
// 초성 검색("ㄱㅇ" → 국어)까지 그대로 되고, 홈 검색창과 다른 결과가 나오지 않는다.
// 필터링은 서버 왕복 없이 이 자리에서 한다(목록이 이미 손에 있다).
export function MixSubjectPicker({
  subjects,
  hrefFor,
  unit,
  emptyMessage,
}: {
  subjects: MixPickerSubject[];
  // 급수 선택을 주소로 이어 붙이는 건 부모(서버 컴포넌트)가 안다.
  hrefFor: (slug: string) => string;
  // 카드 숫자의 단위. 집계 함수가 아직 없는 환경에서는 문제지 수로 떨어진다.
  unit: "question" | "paper";
  // 급수 필터 때문에 목록 자체가 빈 경우의 안내(검색 결과가 없는 것과 다른 상황이다).
  emptyMessage: string;
}) {
  const [query, setQuery] = useState("");

  // matchSubjectIds 는 Subject 를 받아 id 를 돌려준다. 여기서는 slug 가 곧 키라
  // id 자리에 slug 를 넣어 그대로 쓴다(같은 규칙을 두 번 적지 않으려는 것).
  const asSubjects = useMemo<Subject[]>(
    () =>
      subjects.map((s) => ({
        id: s.slug,
        slug: s.slug,
        name: s.name,
        display_order: 0,
      })),
    [subjects],
  );

  const visible = useMemo(() => {
    const q = query.trim();
    if (!q) return subjects;
    const matched = new Set(matchSubjectIds(asSubjects, q));
    return subjects.filter((s) => matched.has(s.slug));
  }, [subjects, asSubjects, query]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-600"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="과목 검색 (예: 국어, ㄱㅇ, 행정)"
          aria-label="과목 검색"
          className="w-full rounded-full border border-zinc-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none placeholder:text-zinc-400 focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder:text-zinc-600"
        />
      </div>

      {subjects.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-500">
          {emptyMessage}
        </p>
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-500">
          &ldquo;{query.trim()}&rdquo;와 맞는 과목이 없어요. 다른 이름으로 찾아보세요.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((s) => (
            <Link
              key={s.slug}
              href={hrefFor(s.slug)}
              className="group flex items-center gap-3 rounded-xl border border-zinc-200 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-700 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
            >
              <span
                className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${subjectColor(s.slug)}`}
              >
                {s.name}
              </span>
              <span className="min-w-0 flex-1 text-xs text-zinc-500 dark:text-zinc-500">
                {s.favorite && <span className="mr-1 text-amber-500">★</span>}
                기출 {s.count.toLocaleString()}
                {unit === "question" ? "문항" : "장"}
              </span>
              <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-blue-600 group-hover:underline dark:text-blue-400">
                섞어풀기
                <ChevronRight size={14} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
