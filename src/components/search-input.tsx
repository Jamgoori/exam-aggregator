"use client";

import { useEffect, useRef } from "react";
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
  // 한글은 마지막 글자의 IME 조합이 열린 채로 남는데, 이 상태로 스크롤을 내려
  // 화면 아래쪽(페이지 버튼 등)을 클릭하면 마우스를 누르는 순간 조합이 확정되고,
  // Chromium이 mousedown 이벤트를 보내기도 전에 이 검색창을 화면 안으로 강제
  // 스크롤한다 — 화면이 통째로 위로 튀고, 클릭은 원래 누르려던 자리로 올라온
  // 엉뚱한 카드에 떨어졌다. 조합 확정(compositionend) 시점에 스크롤이 직전
  // 위치에서 급격히 벗어나 있으면 즉시 되돌린다. 이 복원은 mousedown이 발생하기
  // 전에 실행되므로 클릭도 의도한 자리에 정확히 떨어진다. 문턱(150px)을 둔 것은
  // 조합 중 사용자가 직접 굴린 소소한 스크롤까지 되감지 않기 위해서다.
  const lastScrollY = useRef(0);
  useEffect(() => {
    lastScrollY.current = window.scrollY;
    const onScroll = () => {
      lastScrollY.current = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  function undoImeScrollJump() {
    const y = lastScrollY.current;
    if (Math.abs(window.scrollY - y) > 150) window.scrollTo(0, y);
  }

  return (
    // 596px는 위 소개 문단("국가직·지방직·서울시 ... 정리했어요.")이 한 줄로
    // 렌더링됐을 때 폭과 맞춘 값이라, 그 줄 끝과 오른쪽 끝이 나란해 보인다.
    <div className="flex w-full max-w-[596px] items-center gap-3 rounded-2xl border-2 border-zinc-200 bg-white px-5 py-4 shadow-sm transition-colors focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-100 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-blue-600 dark:focus-within:ring-blue-950/40">
      <Search size={22} className="shrink-0 text-blue-400" />
      <input
        type="search"
        aria-label="과목명으로 검색"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onCompositionEnd={undoImeScrollJump}
        placeholder="과목명으로 검색..."
        className="w-full text-base outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
      />
    </div>
  );
}
