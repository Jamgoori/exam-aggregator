import { Pressable, ScrollView, View } from "react-native";
import { AppText } from "./app-text";
import { hapticSelect } from "../lib/haptics";

// 칩·탭(설계서 §4.5 #4). 활성 `bg-blue-600 text-white`, "전체" 칩은 `bg-zinc-800 text-white`
// (exam-browser GROUPS·과목 페이지 필터 — 초성 탭이 아니다).
export function Chip({
  label,
  active = false,
  tone = "default",
  disabled,
  onPress,
  className,
}: {
  label: string;
  active?: boolean;
  tone?: "default" | "all";
  disabled?: boolean;
  onPress?: () => void;
  className?: string;
}) {
  const activeBox = tone === "all" ? "bg-zinc-800 dark:bg-zinc-200" : "bg-blue-600";
  const activeText = tone === "all" ? "text-white dark:text-zinc-900" : "text-white";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        hapticSelect();
        onPress?.();
      }}
      className={[
        "rounded-full px-4 py-1.5",
        active
          ? activeBox
          : "border border-zinc-200 bg-white active:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:active:bg-zinc-800",
        disabled ? "opacity-40" : "",
        className ?? "",
      ].join(" ")}
    >
      <AppText
        variant="sm"
        weight="medium"
        className={active ? activeText : "text-zinc-600 dark:text-zinc-300"}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

// 가로 스크롤 필터 스트립(스크롤바 숨김).
export function ChipStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className={["-mx-4", className ?? ""].join(" ")}
      contentContainerClassName="flex-row gap-2 px-4"
    >
      {children}
    </ScrollView>
  );
}

// 마이페이지 4탭처럼 N등분 `text-xs rounded-full` 필.
export function SegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <View className={["flex-row rounded-full bg-zinc-100 p-1 dark:bg-zinc-800", className ?? ""].join(" ")}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: !!item.disabled }}
            disabled={item.disabled}
            onPress={() => {
              hapticSelect();
              onChange(item.value);
            }}
            className={[
              "flex-1 items-center rounded-full py-1.5",
              active ? "bg-white shadow-sm dark:bg-zinc-900" : "",
              item.disabled ? "opacity-40" : "",
            ].join(" ")}
          >
            <AppText
              variant="xs"
              weight={active ? "semibold" : "medium"}
              className={active ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500 dark:text-zinc-400"}
            >
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
