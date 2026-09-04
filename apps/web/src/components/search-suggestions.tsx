"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

// 검색창 아래에 구글 자동완성처럼 뜨는 "과목 추천"의 공용 부품.
//
// 원래는 기출문제 목록(/papers)의 검색창(search-input.tsx)에만 있었는데, 홈의
// 검색창에도 같은 추천이 필요해지면서(둘 다 과목명을 치는 자리다) 목록 UI와
// 키보드·포커스 규칙을 여기로 모았다. 두 검색창은 생김새(홈은 버튼 달린 GET 폼,
// 목록은 큰 둥근 입력창)만 다르고 추천 동작은 완전히 같아야 한다.

export type SearchSuggestion = {
  /** 눌렀을 때 갈 과목 페이지(/subjects/:slug) */
  slug: string;
  /** 화면에 보일 이름 — 방금 친 검색어에 맞춘 표기가 이미 적용된 값 */
  name: string;
};

export function useSearchSuggestions({
  value,
  suggestions,
  idPrefix,
}: {
  value: string;
  suggestions: SearchSuggestion[];
  /** aria 연결에 쓰는 id 접두어. 한 화면에 검색창이 둘 이상 떠도 겹치지 않는다. */
  idPrefix: string;
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
  const listboxId = `${idPrefix}-suggestions`;

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

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      // 아무것도 고르지 않았으면 Enter는 원래 하던 일(폼 제출·목록 필터)을 그대로
      // 한다. 골라 둔 항목이 있을 때만 그 과목 페이지로 간다.
      if (highlighted < 0) return;
      e.preventDefault();
      itemRefs.current[highlighted]?.click();
    } else if (e.key === "Escape") {
      setDismissed(true);
    }
  }

  return {
    open,
    /** 입력창에 그대로 펼쳐 넣는다(값·placeholder 등 나머지는 각 검색창이 정한다). */
    inputProps: {
      role: "combobox" as const,
      "aria-expanded": open,
      "aria-controls": listboxId,
      "aria-activedescendant":
        open && highlighted >= 0 ? `${idPrefix}-suggestion-${highlighted}` : undefined,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
      onKeyDown: handleKeyDown,
      onCompositionEnd: undoImeScrollJump,
    },
    /** <SearchSuggestionList {...listProps} /> 로 넘긴다. */
    listProps: {
      id: listboxId,
      idPrefix,
      suggestions,
      highlighted,
      onHighlight: setHighlighted,
      itemRefs,
    },
  };
}

export function SearchSuggestionList({
  id,
  idPrefix,
  suggestions,
  highlighted,
  onHighlight,
  itemRefs,
  className = "",
}: {
  id: string;
  idPrefix: string;
  suggestions: SearchSuggestion[];
  highlighted: number;
  onHighlight: (i: number) => void;
  itemRefs: React.RefObject<(HTMLAnchorElement | null)[]>;
  className?: string;
}) {
  // 추천 목록 위에서 손을 떼는 순간 브라우저 기본 동작(포커스를 그 링크로 옮김)을
  // 막는다 — 입력창이 포커스를 계속 들고 있어야 이 추천창이 그대로 열려 있다.
  // 막아도 click 이벤트는 그대로 발생하므로 이동(Link 이동)은 정상 동작한다.
  // (페이지 버튼의 keepFocus와 같은 트릭 — exam-browser.tsx 참고.)
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  return (
    <ul
      id={id}
      role="listbox"
      aria-label="과목 바로가기"
      className={`animate-modal-fade-in absolute top-full right-0 left-0 z-20 mt-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white py-1.5 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40 ${className}`}
    >
      {suggestions.map((s, i) => (
        <li key={s.slug} role="presentation">
          <Link
            id={`${idPrefix}-suggestion-${i}`}
            role="option"
            aria-selected={highlighted === i}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            href={`/subjects/${s.slug}`}
            onMouseDown={keepFocus}
            onMouseEnter={() => onHighlight(i)}
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
  );
}
