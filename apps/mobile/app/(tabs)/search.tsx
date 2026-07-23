import { Text, View } from "react-native";
import { colors } from "../../src/theme/colors";

// TODO: 웹 paper-search / hangul.ts(초성 검색) 로직 이식. 지금은 자리표시자.
export default function SearchScreen() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ color: colors.textMuted, textAlign: "center" }}>
        검색 화면 (예정){"\n"}웹 paper-search + 초성검색(hangul.ts) 이식
      </Text>
    </View>
  );
}
