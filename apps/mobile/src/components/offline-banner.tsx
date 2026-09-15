import { View } from "react-native";
import { AppText } from "./app-text";

// "지금 보이는 게 저장해둔 내용"임을 알린다. 오프라인인데 아무 안내가 없으면 사용자가
// 오래된 목록을 최신으로 착각한다(설계서 §6.5 — 오프라인은 읽기 전용).
export function OfflineBanner({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <View
      accessibilityRole="alert"
      className="mb-3 rounded-[10px] border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
    >
      <AppText variant="xs" className="text-zinc-500 dark:text-zinc-400">
        오프라인이에요 — 마지막으로 받아둔 내용을 보여주고 있어요.
      </AppText>
    </View>
  );
}
