"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  SearchSuggestionList,
  useSearchSuggestions,
} from "@/components/search-suggestions";
import {
  getSubjectSuggestions,
  type SuggestibleSubject,
} from "@/lib/subject-suggestions";

// 홈(랜딩)의 기출문제 검색창.
//
// 원래는 /papers 로 그냥 넘기는 GET 폼이었다. 그런데 홈에서 과목명을 치는 사람은
// 대개 그 과목 자료를 보러 온 것이라, 검색 버튼 → 목록 → 다시 과목 찾기까지 한
// 단계를 더 밟아야 했다. 기출문제 목록의 검색창에는 이미 과목 추천이 붙어 있었으므로
// (search-input.tsx) 같은 추천을 홈에도 붙이고, 동작은 한 부품으로 공유한다.
//
// 폼은 그대로 남겨 둔다 — 추천은 거들 뿐이고, 엔터·검색 버튼은 예전처럼 /papers 의
// 검색 결과로 간다(자바스크립트가 아직 안 붙었거나 추천에 없는 검색어여도 똑같이
// 동작한다). 추천 목록은 과목 목록이 실제로 걸릴 때만 열린다.
export function HomeSearchBox({
  subjects,
  examTypeNames,
}: {
  subjects: SuggestibleSubject[];
  examTypeNames: string[];
}) {
  const [query, setQuery] = useState("");
  // 과목 수가 수백 개라 매 글자마다 필터가 도는데, 입력 자체가 밀리지 않도록
  // 목록 계산은 한 박자 뒤처져도 되는 값으로 둔다.
  const deferredQuery = useDeferredValue(query);
  const suggestions = useMemo(
    () => getSubjectSuggestions(subjects, deferredQuery, examTypeNames),
    [subjects, deferredQuery, examTypeNames],
  );
  const { open, inputProps, listProps } = useSearchSuggestions({
    value: query,
    suggestions,
    idPrefix: "home-landing-search",
  });

  return (
    <div className="relative mt-8">
      <form
        action="/papers"
        method="get"
        role="search"
        className="flex items-center rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-950"
      >
        <Search size={18} className="ml-2.5 shrink-0 text-zinc-400" aria-hidden />
        <input
          type="search"
          name="q"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="예: 2025 국가직 행정법, 9급 국어"
          aria-label="기출문제 검색"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
          {...inputProps}
        />
        <button
          type="submit"
          className="rounded-lg bg-[#012854] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#0a3a72] dark:bg-[#0a7d5b] dark:hover:bg-[#096b4e]"
        >
          검색
        </button>
      </form>

      {open && <SearchSuggestionList {...listProps} />}
    </div>
  );
}
