// 생성 파일 — 직접 고치지 말 것. 정본은 theme.css, 갱신은 `npm run gen -w @gongmoa/design-tokens`.
// 라이트/다크가 완전히 해석된 hex 값. CSS 변수를 못 읽는 소비자(RN Skia 캔버스·StatusBar·
// lucide color prop·AdMob 배경·adaptiveIcon.backgroundColor 등)용.

export const tokens = {
  light: {
    background: "#ffffff",
    foreground: "#171717",
    colorScheme: "light",
    blue: {
      "50": "#ecfdf5",
      "100": "#d1fae5",
      "200": "#a7f3d0",
      "300": "#6ee7b7",
      "400": "#34d399",
      "500": "#12b382",
      "600": "#0a7d5b",
      "700": "#06664a",
      "800": "#065f46",
      "900": "#064e3b",
      "950": "#022c22",
    },
  },
  dark: {
    background: "#0a0a0a",
    foreground: "#ededed",
    colorScheme: "dark",
    blue: {
      "50": "#ecfdf5",
      "100": "#d1fae5",
      "200": "#a7f3d0",
      "300": "#6ee7b7",
      "400": "#2ec48f",
      "500": "#0fa374",
      "600": "#096b4e",
      "700": "#065a41",
      "800": "#065f46",
      "900": "#064e3b",
      "950": "#022c22",
    },
  },
} as const;

export type Tokens = typeof tokens;
export type Theme = keyof Tokens;
export type ThemeTokens = Tokens[Theme];
export type BlueShade = keyof Tokens["light"]["blue"];

export const lightTokens = tokens.light;
export const darkTokens = tokens.dark;

export function themeTokens(theme: Theme): ThemeTokens {
  return tokens[theme];
}
