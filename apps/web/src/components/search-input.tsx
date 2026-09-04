"use client";

import { Search } from "lucide-react";
import type { Subject } from "@gongmoa/core";
import {
  SearchSuggestionList,
  useSearchSuggestions,
} from "@/components/search-suggestions";

// 예전엔 이 컴포넌트가 직접 라우팅(router.push)까지 담당해서, 입력할 때마다
// 디바운스 후 서버를 다시 왕복했다. 이제 필터링은 부모(ExamBrowser)가 받은
// 문제지 목록을 그 자리에서 즉시 걸러내는 방식이라 디바운스 자체가 필요 없어졌고,
// 이 컴포넌트는 순수하게 값을 보여주고 바뀐 값을 그대로 부모에 올려보내기만 한다.
//
// suggestions(구글 검색창처럼 입력 아래에 뜨는 과목 추천)만 예외다 — 검색창은
// 이미 매 입력마다 과목 목록을 필터링해 카드로 보여주고 있지만, 그 결과가
// 스크롤을 한참 내려야 나오는 카드 그리드라 "과목 자체"로 바로 가고 싶은
// 사람에게는 느리다. 추천 항목을 누르면 그 과목의 전용 페이지(/subjects/:slug)로
// 곧장 이동한다. 추천창의 동작(키보드·포커스·IME)은 홈 검색창과 공유한다
// (components/search-suggestions.tsx).
export function SearchInput({
  value,
  onChange,
  suggestions = [],
}: {
  value: string;
  onChange: (next: string) => void;
  suggestions?: Subject[];
}) {
  const { open, inputProps, listProps } = useSearchSuggestions({
    value,
    suggestions,
    idPrefix: "home-search",
  });

  return (
    // 596px는 위 소개 문단("국가직·지방직·서울시 ... 정리했어요.")이 한 줄로
    // 렌더링됐을 때 폭과 맞춘 값이라, 그 줄 끝과 오른쪽 끝이 나란해 보인다.
    <div className="relative w-full max-w-[596px]">
      <div
        className={`flex items-center gap-3 rounded-2xl border-2 bg-white px-5 py-4 shadow-sm transition-colors dark:bg-zinc-900 ${
          open
            ? "border-blue-400 ring-4 ring-blue-100 dark:border-blue-600 dark:ring-blue-950/40"
            : "border-zinc-200 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100 dark:border-zinc-700 dark:focus-within:border-blue-600 dark:focus-within:ring-blue-950/40"
        }`}
      >
        <Search size={22} className="shrink-0 text-blue-400" />
        <input
          type="search"
          aria-label="과목명으로 검색"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // 과목명뿐 아니라 급수·연도·시행처를 섞어 쳐도 되는 검색창이라(parseSearchQuery),
          // 그 사실을 설명 문장 대신 예시로 보여준다.
          placeholder="예: 2024 국가직 행정법, 9급 국어"
          className="w-full text-base outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
          {...inputProps}
        />
      </div>

      {open && <SearchSuggestionList {...listProps} />}
    </div>
  );
}
