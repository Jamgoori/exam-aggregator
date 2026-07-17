"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const STORAGE_KEY = "theme";
const THEME_CHANGE_EVENT = "themechange";

function subscribe(callback: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, callback);
}

function getSnapshot() {
  return document.documentElement.getAttribute("data-theme") === "dark";
}

// layout.tsx의 인라인 스크립트가 <html data-theme>를 첫 페인트 전에 정해두지만
// 서버 렌더링 시점에는 그 값을 알 수 없다. 예전에는 이 값을 아이콘 선택(JSX 조건부
// 렌더링)에 직접 써서, 다크모드 사용자가 새로고침할 때마다 하이드레이션 전엔 항상
// 라이트 기준 아이콘(Moon)이 그려졌다가 하이드레이션 직후 실제 값(Sun)으로 바뀌는
// 깜빡임이 있었다. 지금은 아이콘 자체를 data-theme 속성에 반응하는 CSS(dark:)로
// 그리고, 이 훅의 isDark 값은 aria-label 텍스트에만 쓴다 — 라벨은 화면에 보이는
// 요소가 아니라 하이드레이션 시점에 잠깐 어긋나도 깜빡임으로 보이지 않는다.
function getServerSnapshot() {
  return false;
}

export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next = isDark ? "light" : "dark";
    const apply = () => {
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // localStorage를 쓸 수 없어도(시크릿 모드 등) 토글 자체는 계속 동작해야 한다.
      }
      window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
    };

    // 지원 브라우저는 크로스페이드 전환(globals.css의 ::view-transition-* 참고),
    // 미지원이거나 모션을 줄이길 원하는 경우 그냥 즉시 전환한다.
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && document.startViewTransition) {
      document.startViewTransition(apply);
    } else {
      apply();
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      suppressHydrationWarning
      className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <Moon size={18} className="dark:hidden" />
      <Sun size={18} className="hidden dark:block" />
    </button>
  );
}
