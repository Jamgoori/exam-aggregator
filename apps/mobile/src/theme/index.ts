import { tokens } from "@gongmoa/design-tokens";
import { useEffect, useSyncExternalStore } from "react";
import { Uniwind, useUniwind } from "uniwind";
import { kvGet, kvRemove, kvSet } from "../lib/kv";

// 테마 토큰(라이트/다크 완전 해석 hex). className 으로 못 주는 자리(StatusBar·탭바 tint·
// Skia·LinearGradient)에서만 쓴다. 나머지는 웹과 같은 Tailwind 클래스 문자열이다.
export { tokens };

// Tailwind v4 기본 팔레트 중 값이 prop 으로 필요한 것만(oklch → hex, Uniwind 컴파일 결과와
// 같은 값). 클래스로 쓸 수 있는 자리에서는 이 표를 쓰지 말 것.
export const palette = {
  white: "#ffffff",
  black: "#000000",
  brand: "#12b382",
  navy: "#012854",
  kakao: "#FEE500",
  zinc: {
    50: "#fafafa",
    100: "#f4f4f5",
    200: "#e4e4e7",
    300: "#d4d4d8",
    400: "#9f9fa9",
    500: "#71717b",
    600: "#52525c",
    700: "#3f3f46",
    800: "#27272a",
    900: "#18181b",
    950: "#09090b",
  },
  red: { 500: "#fb2c36", 600: "#e7000b" },
  emerald: { 500: "#00bc7d", 600: "#009966" },
  amber: { 500: "#fd9a00" },
  // 스켈레톤 하이라이트는 토큰이 아니라 리터럴(웹 globals.css .skeleton::after — 진짜 파랑 blue-100).
  skeletonSweep: ["rgba(219,234,254,0)", "rgba(219,234,254,0.9)", "rgba(255,255,255,0.95)", "rgba(219,234,254,0.9)", "rgba(219,234,254,0)"],
} as const;

// ── 테마 선택(웹 theme-toggle.tsx 규칙, 설계서 §4.3) ─────────────────────────
// kv 키 `theme`(light|dark), 없으면 시스템. 적용은 Uniwind.setTheme **하나만** 부른다 —
// Uniwind 가 내부에서 Appearance.setColorScheme 을 대신 호출해 키보드·시트·상태바까지
// 맞춘다. Appearance 를 직접 부르면 중복이고 되돌림 루프가 생긴다.
export type ThemePreference = "light" | "dark" | null;

let preference: ThemePreference = null;
let loaded = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function apply(pref: ThemePreference) {
  Uniwind.setTheme(pref ?? "system");
}

export async function loadThemePreference(): Promise<void> {
  if (loaded) return;
  loaded = true;
  const raw = await kvGet("theme");
  preference = raw === "dark" || raw === "light" ? raw : null;
  apply(preference);
  notify();
}

// 이 함수는 **적용을 동기로 끝낸다**(저장만 await). theme-transition.tsx 가 판이 화면을 덮은
// 프레임에 이걸 부르고 곧바로 `Uniwind.currentTheme` 을 읽어 걷을 때 쓸 배경색을 정하므로,
// 적용을 await 뒤로 미루면 판이 옛 색으로 걷혀 색이 튄다. 애니메이션은 호출부 몫이라 여기에는
// 넣지 않는다.
export async function setThemePreference(next: ThemePreference): Promise<void> {
  preference = next;
  apply(next);
  notify();
  if (next) await kvSet("theme", next);
  else await kvRemove("theme");
}

export function useThemePreference() {
  const pref = useSyncExternalStore(subscribe, () => preference, () => preference);
  useEffect(() => {
    void loadThemePreference();
  }, []);
  return { preference: pref, setPreference: setThemePreference };
}

export function useIsDark(): boolean {
  return useUniwind().theme === "dark";
}

// 현재 테마의 해석된 토큰(StatusBar·탭바 등 prop 용).
export function useThemeTokens() {
  return useIsDark() ? tokens.dark : tokens.light;
}
