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

// ── 게시판 본문(richText) 토큰 — 웹 globals.css `.board-content`(410-470행) 1:1 ─────────
// 설계서 §4.1 `richText` 행. RichTextContent(components/rich-text-content.tsx)가 임의값을
// 쓰지 않게 여기에 모아 둔다. 웹 rem 은 루트 16px 기준으로 px 로 푼 값이고, 색은 Tailwind
// 클래스가 정확히 같은 hex 를 주는 자리(zinc-700/200 본문, blue-300 인용 선, blue-600/400 링크,
// zinc-100/800 pre 배경, zinc-200/700 hr)는 className 으로 두고, 웹이 리터럴로 적어 Tailwind v4
// 팔레트와 어긋나는 blockquote 글자색(#52525b/#a1a1aa — v3 zinc-600/400)만 값으로 둔다.
export const richText = {
  // `.board-content text-[15px] leading-7` — 모든 블록이 이 줄높이를 상속한다.
  fontSize: 15,
  lineHeight: 28,
  // `p { margin: 0; min-height: 1lh }` — 빈 줄(엔터)도 한 줄 높이를 차지한다. 여백 0 은 웹이 div 문단
  // (옛 웹 에디터 저장분)과 p 문단(새 웹 에디터·앱 저장분)을 같은 모습으로 그리려고 2026-09-19 에 맞춘
  // 값이다(globals.css 주석, 설계서 §13 질문 17). 문단 사이 간격은 빈 줄로만 생긴다.
  paragraph: { marginBottom: 0, minHeight: 28 },
  h2: { fontSize: 20, marginTop: 20, marginBottom: 8 },
  h3: { fontSize: 17.6, marginTop: 16, marginBottom: 8 },
  // `ul, ol { margin: 0.5rem 0; padding-left: 1.5rem }`, `li { margin: 0.15rem 0 }`.
  list: { marginVertical: 8, paddingLeft: 24 },
  listItem: { marginVertical: 2.4 },
  // 마커(disc/decimal)는 CSS list-style-position: outside — 들여쓰기 안쪽에 오른쪽 정렬로 놓고
  // 글과의 틈은 브라우저 마커 박스의 공백 한 칸(≈0.4em) 만큼.
  listMarkerGap: 6,
  // `blockquote { margin: 0.75rem 0; border-left: 3px; padding: 0.25rem 0 0.25rem 0.85rem }`.
  blockquote: {
    marginVertical: 12,
    borderLeftWidth: 3,
    paddingVertical: 4,
    paddingLeft: 13.6,
    color: { light: "#52525b", dark: "#a1a1aa" },
  },
  // `hr { margin: 1.25rem 0; border-top: 1px }`.
  hr: { marginVertical: 20, borderTopWidth: 1 },
  // `pre { margin: 0.75rem 0; border-radius: 0.5rem; padding: 0.75rem 1rem }`,
  // `pre, code { font-size: 0.9em }` — em 이라 본문 15px 의 0.9 = 13.5px, 중첩되면 다시 0.9배.
  pre: { marginVertical: 12, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 16 },
  codeFontScale: 0.9,
  // `img { margin: 0.75rem 0; max-width: 100%; height: auto; border-radius: 0.75rem }`.
  image: { marginVertical: 12, borderRadius: 12, placeholderAspectRatio: 4 / 3 },
} as const;
