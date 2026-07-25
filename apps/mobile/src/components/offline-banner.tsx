import { Text, View } from "react-native";
import { useColors } from "../theme/colors";

// "지금 보이는 게 저장해둔 내용"임을 알린다. 오프라인인데 아무 안내가 없으면 사용자가
// 오래된 목록을 최신으로 착각한다.
export function OfflineBanner({ visible }: { visible: boolean }) {
  const colors = useColors();
  if (!visible) return null;
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text style={{ color: colors.textMuted, fontSize: 12 }}>
        오프라인이에요 — 마지막으로 받아둔 내용을 보여주고 있어요.
      </Text>
    </View>
  );
}
