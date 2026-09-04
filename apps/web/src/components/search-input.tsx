"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import type { Subject } from "@gongmoa/core";

// 예전엔 이 컴포넌트가 직접 라우팅(router.push)까지 담당해서, 입력할 때마다
// 디바운스 후 서버를 다시 왕복했다. 이제 필터링은 부모(ExamBrowser)가 받은
// 문제지 목록을 그 자리에서 즉시 걸러내는 방식이라 디바운스 자체가 필요 없어졌고,
// 이 컴포넌트는 순수하게 값을 보여주고 바뀐 값을 그대로 부모에 올려보내기만 한다.
//
// suggestions(구글 검색창처럼 입력 아래에 뜨는 과목 추천)만 예외다 — 검색창은
// 이미 매 입력마다 과목 목록을 필터링해 카드로 보여주고 있지만, 그 결과가
// 스크롤을 한참 내려야 나오는 카드 그리드라 "과목 자체"로 바로 가고 싶은
// 사람에게는 느리다. 추천 항목을 누르면 그 과목의 전용 페이지(/subjects/:slug)로
// 곧장 이동한다.
export function SearchInput({
  value,
  onChange,
  suggestions = [],
}: {
  value: string;
  onChange: (next: string) => void;
  suggestions?: Subject[];
}) {
  const [focused, setFocused] = useState(false);
  // Esc로 닫은 뒤에는 같은 검색어로 다시 포커스해도 스스로 열리지 않아야 한다 —
  // 값이 바뀌면(글자를 더 치거나 지우면) 다시 열 만한 새 상황이니 풀어준다.
  const [dismissed, setDismissed] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  // 렌더 중에 이전 값과 비교해 리셋한다(리액트가 권장하는 "prop이 바뀌면 state를
  // 맞춘다" 패턴 — state로 이전 값을 들고 있다가 달라지면 그 자리에서 바로
  // setState한다). useEffect로 하면 한 프레임 늦게 열려서, 지우자마자 목록이
  // 한 번 번쩍였다가 닫히는 게 보인다.
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setDismissed(false);
    setHighlighted(-1);
  }

  const open = focused && !dismissed && suggestions.length > 0;

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

  // 추천 목록 위에서 손을 떼는 순간 브라우저 기본 동작(포커스를 그 링크로 옮김)을
  // 막는다 — 입력창이 포커스를 계속 들고 있어야 이 추천창이 그대로 열려 있다.
  // 막아도 click 이벤트는 그대로 발생하므로 이동(Link 이동)은 정상 동작한다.
  // (페이지 버튼의 keepFocus와 같은 트릭 — exam-browser.tsx 참고.)
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (highlighted < 0) return;
      e.preventDefault();
      itemRefs.current[highlighted]?.click();
    } else if (e.key === "Escape") {
      setDismissed(true);
    }
  }

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
          role="combobox"
          aria-label="과목명으로 검색"
          aria-expanded={open}
          aria-controls="home-search-suggestions"
          aria-activedescendant={
            open && highlighted >= 0 ? `home-search-suggestion-${highlighted}` : undefined
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onCompositionEnd={undoImeScrollJump}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder="과목명으로 검색..."
          className="w-full text-base outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
        />
      </div>

      {open && (
        <ul
          id="home-search-suggestions"
          role="listbox"
          aria-label="과목 바로가기"
          className="animate-modal-fade-in absolute top-full right-0 left-0 z-20 mt-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white py-1.5 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40"
        >
          {suggestions.map((s, i) => (
            <li key={s.id} role="presentation">
              <Link
                id={`home-search-suggestion-${i}`}
                role="option"
                aria-selected={highlighted === i}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                href={`/subjects/${s.slug}`}
                onMouseDown={keepFocus}
                onMouseEnter={() => setHighlighted(i)}
                className={`flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors ${
                  highlighted === i
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                    : "text-zinc-700 dark:text-zinc-300"
                }`}
              >
                <Search size={14} className="shrink-0 text-zinc-400" />
                <span className="flex-1 truncate font-medium">{s.name}</span>
                <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
                  과목 페이지로 이동
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
