import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { colors } from "../../../src/theme/colors";

// ─────────────────────────────────────────────────────────────────────────────
// CBT 풀이 — 앱에서 재구현 부담이 가장 큰 화면 (웹 cbt-solver.tsx 814줄).
//
// 이식해야 할 조각들:
//   1. 전체보기: PdfViewer(react-native-pdf) + 펜 필기(react-native-skia) + 핀치줌
//   2. 문제별 보기: getQuestionImages() 크롭 이미지 + 핀치줌
//   3. 상태: OMR 선택, 남은 시간, 뷰모드 잠금(user_metadata.default_cbt_view_mode)
//   4. 채점: cbt_attempts / cbt_attempt_answers 저장(웹과 동일 테이블·RLS)
//
// 지금은 라우팅·데이터 흐름만 뚫어둔 자리표시자. src/components/ 의 뷰어 스텁 참고.
// ─────────────────────────────────────────────────────────────────────────────
export default function CbtScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 }}>
      <Text style={{ fontWeight: "600" }}>CBT 풀이 (구축 예정)</Text>
      <Text style={{ color: colors.textMuted, textAlign: "center" }}>
        paperId: {id}
        {"\n"}PDF/필기/핀치줌 뷰어 이식 지점
      </Text>
    </View>
  );
}
