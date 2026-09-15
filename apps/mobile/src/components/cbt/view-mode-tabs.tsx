import type { CbtViewMode } from "@gongmoa/core";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { ViewModeLock } from "./view-mode-lock";

// 탭(문제별 풀기·전체보기) + 자물쇠 한 벌(웹 cbt-solver.tsx viewModeTabs). 앱은 폰 폭 레이아웃만이라
// 언제나 헤더 아래 탭 줄에 그린다(§4.4 lg 미이식). 이미지 없는 문제지는 "문제별 풀기" disabled
// (opacity-40) + 안내 "문항별 이미지가 아직 등록되지 않았어요"(웹 title → accessibilityHint).
const TAB_BASE = "shrink-0 rounded-full px-2.5 py-1";

function Tab({
  label,
  active,
  disabled,
  hint,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={onPress}
      className={[
        TAB_BASE,
        active ? "bg-blue-600" : "active:bg-zinc-100 dark:active:bg-zinc-800",
        disabled ? "opacity-40" : "",
      ].join(" ")}
    >
      <AppText variant="13" weight="medium" className={active ? "text-white" : "text-zinc-500 dark:text-zinc-500"}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function ViewModeTabs({
  viewMode,
  hasQuestionImages,
  onSwitch,
  savedDefaultViewMode,
  onSavedDefaultViewModeChange,
}: {
  viewMode: CbtViewMode;
  hasQuestionImages: boolean;
  onSwitch: (mode: CbtViewMode) => void;
  savedDefaultViewMode: CbtViewMode | null;
  onSavedDefaultViewModeChange: (next: CbtViewMode | null) => void;
}) {
  return (
    <View className="flex-row items-center gap-1">
      <Tab
        label="문제별 풀기"
        active={viewMode === "single"}
        disabled={!hasQuestionImages}
        hint={hasQuestionImages ? undefined : "문항별 이미지가 아직 등록되지 않았어요"}
        onPress={() => onSwitch("single")}
      />
      <Tab label="전체보기" active={viewMode === "full"} onPress={() => onSwitch("full")} />
      <ViewModeLock
        viewMode={viewMode}
        savedDefaultViewMode={savedDefaultViewMode}
        onSavedDefaultViewModeChange={onSavedDefaultViewModeChange}
      />
    </View>
  );
}
