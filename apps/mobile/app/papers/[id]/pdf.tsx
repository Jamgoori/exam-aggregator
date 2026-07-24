import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { PdfPenViewer } from "../../../src/components/pdf-pen-viewer";
import { getPaper } from "../../../src/lib/papers";
import { publicUrl } from "../../../src/lib/storage";
import { colors } from "../../../src/theme/colors";

// 원본 PDF 보기 — 문제지 상세의 "원본 PDF". 필기 도구도 그대로 쓸 수 있다.
export default function PaperPdfScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getPaper(String(id))
      .then((p) => setFileUrl(p?.file_path ? publicUrl(p.file_path) : null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: "원본 PDF" }} />
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator />
        </View>
      ) : fileUrl ? (
        <PdfPenViewer fileUrl={fileUrl} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.textMuted }}>PDF를 찾을 수 없어요.</Text>
        </View>
      )}
    </View>
  );
}
