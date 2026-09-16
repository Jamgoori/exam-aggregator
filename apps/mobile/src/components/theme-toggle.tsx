import { Moon, Sun } from "lucide-react-native";
import { Pressable } from "react-native";
import { themedIcon } from "../theme/icons";
import { useIsDark } from "../theme";
import { startThemeTransition } from "../theme/theme-transition";

// 웹 theme-toggle.tsx 규칙(설계서 §4.3): kv `theme` 에 light|dark 저장, 아이콘 Moon(라이트)/
// Sun(다크) 18. 적용은 Uniwind.setTheme 하나(theme/index.ts).
//
// 400ms 전환은 `startThemeTransition` 이 맡는다(웹의 크로스페이드 자리 — RN 에는 스냅샷이 없어
// 전면 워시로 간다, theme-transition.tsx) — Uniwind 의 리렌더 자체는 깜빡이지 않지만 화면 전체가
// 한 프레임에 갈리는 하드컷이라, 웹(View Transition)에서 넘어온 사람에게는 화면이 튄 것처럼
// 보인다. 판정·저장은 그대로 두고 시점만 감싼다.
const MoonIcon = themedIcon(Moon);
const SunIcon = themedIcon(Sun);

export function ThemeToggle() {
  const isDark = useIsDark();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      onPress={() => startThemeTransition(isDark ? "light" : "dark")}
      className="h-9 w-9 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
    >
      {isDark ? (
        <SunIcon size={18} colorClassName="text-zinc-400" />
      ) : (
        <MoonIcon size={18} colorClassName="text-zinc-600" />
      )}
    </Pressable>
  );
}
