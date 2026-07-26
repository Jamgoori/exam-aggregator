import { useColorScheme } from "react-native";

// 웹 Tailwind zinc/blue 팔레트를 앱에서 재사용하기 위한 최소 토큰.
//
// 웹은 CSS 변수 + dark: 클래스로 다크모드를 처리하지만 RN 에는 그런 캐스케이드가 없어서,
// 팔레트를 두 벌 두고 useColors() 훅이 OS 설정(useColorScheme)에 맞는 쪽을 돌려준다.
// 화면은 렌더 중에 색을 받으므로 OS 에서 테마를 바꾸면 즉시 따라간다. 모듈 스코프에서
// 색을 읽으면(예전 `const rowStyle = {...colors...}`) 테마 변경을 못 따라가므로, 그런
// 스타일은 colors 를 인자로 받는 함수로 둔다.
export type Colors = {
  bg: string;
  card: string;
  border: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryText: string;
  kakao: string;
  danger: string;
  // 정답·극복 표시(초록)와 주의 문구(주황). 다크 배경에서 green-600/amber-600 은 대비가
  // 모자라서 테마별로 다른 명도를 쓴다.
  success: string;
  warning: string;
};

export const lightColors: Colors = {
  bg: "#ffffff",
  card: "#fafafa",
  border: "#e4e4e7",
  text: "#18181b",
  textMuted: "#71717a",
  primary: "#2563eb",
  primaryText: "#ffffff",
  kakao: "#FEE500",
  danger: "#dc2626",
  success: "#16a34a",
  warning: "#d97706",
};

// 웹 다크모드가 쓰는 zinc-900/800/700 계열과 blue-400 강조에 맞춘 값.
export const darkColors: Colors = {
  bg: "#18181b",
  card: "#27272a",
  border: "#3f3f46",
  text: "#fafafa",
  textMuted: "#a1a1aa",
  primary: "#3b82f6",
  primaryText: "#ffffff",
  // 카카오 노랑은 브랜드 색이라 테마와 무관하게 고정한다.
  kakao: "#FEE500",
  danger: "#f87171",
  success: "#4ade80",
  warning: "#fbbf24",
};

export function useColors(): Colors {
  return useColorScheme() === "dark" ? darkColors : lightColors;
}

// 상태바 스타일처럼 색이 아니라 "지금 다크인가"가 필요한 곳에서 쓴다.
export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}
