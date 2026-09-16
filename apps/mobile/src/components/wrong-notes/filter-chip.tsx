import { Pressable } from "react-native";
import { AppText } from "../app-text";

// 오답노트 화면들의 필터 칩(웹 subject-wrong-note-questions.tsx·mix-session-view.tsx 의 chip()):
// `rounded-full px-3.5 py-2 text-sm font-medium`, 활성 `bg-blue-600 text-white`, 비활성 테두리,
// disabled `opacity-40`. 공용 Chip(§4.5 #4)은 `px-4 py-1.5` 규격이라 여기서는 쓰지 않는다.
export function WrongNoteFilterChip({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={[
        "shrink-0 rounded-full px-3.5 py-2",
        active ? "bg-blue-600" : "border border-zinc-200 dark:border-zinc-700",
        disabled ? "opacity-40" : "",
      ].join(" ")}
    >
      <AppText variant="sm" weight="medium" className={active ? "text-white" : "text-zinc-600 dark:text-zinc-400"}>
        {label}
      </AppText>
    </Pressable>
  );
}
