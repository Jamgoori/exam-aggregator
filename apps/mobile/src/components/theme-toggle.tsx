import { Moon, Sun } from "lucide-react-native";
import { Pressable } from "react-native";
import { themedIcon } from "../theme/icons";
import { useIsDark, useThemePreference } from "../theme";

// 웹 theme-toggle.tsx 규칙(설계서 §4.3): kv `theme` 에 light|dark 저장, 아이콘 Moon(라이트)/
// Sun(다크) 18. 적용은 Uniwind.setTheme 하나(theme/index.ts). 400ms 크로스페이드는 선택 —
// Uniwind 가 테마 전환을 동기 리렌더로 처리해 깜빡임이 없어 생략.
const MoonIcon = themedIcon(Moon);
const SunIcon = themedIcon(Sun);

export function ThemeToggle() {
  const isDark = useIsDark();
  const { setPreference } = useThemePreference();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
      onPress={() => void setPreference(isDark ? "light" : "dark")}
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
