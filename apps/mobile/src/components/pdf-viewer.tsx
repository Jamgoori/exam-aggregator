import { Text, View } from "react-native";
import { colors } from "../theme/colors";

// 웹 pdf-canvas-viewer.tsx(pdf.js) 대체 스텁.
// 실제 구현: `npx expo install react-native-pdf` 후 아래 Pdf 로 교체.
// pdf.js 는 브라우저 전용(Worker/canvas)이라 앱엔 못 쓴다 — 네이티브 PDF 렌더러 사용.
//
//   import Pdf from "react-native-pdf";
//   <Pdf source={{ uri: fileUrl, cache: true }} style={{ flex: 1 }}
//        enablePaging scale={zoom} onLoadComplete={...} />
//
// 펜 필기는 이 위에 react-native-skia Canvas 를 절대위치로 덮어 구현(웹 DrawTool 대응).

export function PdfViewer({ fileUrl }: { fileUrl: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.textMuted }}>PDF 뷰어 자리 (react-native-pdf)</Text>
      <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 4 }}>{fileUrl}</Text>
    </View>
  );
}
