"use client";

import { Search } from "lucide-react";

// 예전엔 이 컴포넌트가 직접 라우팅(router.push)까지 담당해서, 입력할 때마다
// 디바운스 후 서버를 다시 왕복했다. 이제 필터링은 부모(HomeExamBrowser)가 받은
// 문제지 목록을 그 자리에서 즉시 걸러내는 방식이라 디바운스 자체가 필요 없어졌고,
// 이 컴포넌트는 순수하게 값을 보여주고 바뀐 값을 그대로 부모에 올려보내기만 한다.
export function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    // 596px는 위 소개 문단("국가직·지방직·서울시 ... 정리했어요.")이 한 줄로
    // 렌더링됐을 때 폭과 맞춘 값이라, 그 줄 끝과 오른쪽 끝이 나란해 보인다.
    <div className="flex w-full max-w-[596px] items-center gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-5 py-4 shadow-sm transition-colors focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100">
      <Search size={22} className="shrink-0 text-blue-400" />
      <input
        type="search"
        aria-label="과목명으로 검색"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="과목명으로 검색..."
        className="w-full text-base outline-none placeholder:text-zinc-400"
      />
    </div>
  );
}
