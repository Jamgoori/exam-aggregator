import type { NavIconName } from "@gongmoa/core";
import {
  Bell,
  BookOpenCheck,
  BrainCircuit,
  CalendarCheck,
  Crown,
  FileStack,
  Library,
  Megaphone,
  MessagesSquare,
  MessageSquarePlus,
  Receipt,
  Settings,
  Shuffle,
  Star,
  Trophy,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { withUniwind } from "uniwind";

// core nav-items.ts 의 아이콘 이름 문자열 → lucide-react-native 컴포넌트. 웹
// site-nav-items.ts 와 같은 표 — 이름을 빠뜨리면 NavIconName 유니온이 타입 오류를 낸다.
export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  Bell,
  BookOpenCheck,
  BrainCircuit,
  CalendarCheck,
  Crown,
  FileStack,
  Library,
  Megaphone,
  MessagesSquare,
  MessageSquarePlus,
  Receipt,
  Settings,
  Shuffle,
  Star,
  Trophy,
  UserRound,
};

// lucide 의 color 는 prop 이라 className 이 안 먹는다. Uniwind HOC 로 감싸면
// `colorClassName="text-zinc-400 dark:text-zinc-500"` 처럼 웹 클래스 문자열 그대로 색을
// 줄 수 있고 테마 전환도 따라간다. 아이콘마다 한 번만 감싸 캐시한다.
//
// 자동 매핑(withUniwind(icon))은 colorClassName 에서 `accent-*` 만 읽는다(styles.accentColor).
// 호출부는 전부 웹 클래스 `text-*` 를 넘기므로 수동 매핑으로 `color` ← styles.color 를 명시한다 —
// 안 그러면 color 가 undefined → lucide 기본 currentColor → Android 에서 검정(다크에서 안 보임).
const ICON_COLOR_MAPPING = { color: { fromClassName: "colorClassName", styleProperty: "color" } } as const;
type ThemedIcon = ReturnType<typeof withUniwind<LucideIcon, typeof ICON_COLOR_MAPPING>>;
const cache = new WeakMap<LucideIcon, ThemedIcon>();

export function themedIcon(icon: LucideIcon): ThemedIcon {
  let c = cache.get(icon);
  if (!c) {
    c = withUniwind(icon, ICON_COLOR_MAPPING);
    cache.set(icon, c);
  }
  return c;
}

// 드로어 행이 렌더 중에 컴포넌트를 만들지 않도록(react-hooks/static-components) 모듈 로드 때
// 한 번 감싸 둔 표.
export const NAV_THEMED_ICONS = Object.fromEntries(
  (Object.keys(NAV_ICONS) as NavIconName[]).map((name) => [name, themedIcon(NAV_ICONS[name])]),
) as Record<NavIconName, ThemedIcon>;
