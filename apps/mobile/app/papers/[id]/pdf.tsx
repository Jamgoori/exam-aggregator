import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import type { ExamPaper } from "@gongmoa/core";
import { PdfPenViewer } from "../../../src/components/pdf-pen-viewer";
import { countDownload, downloadAndOpenPdf } from "../../../src/lib/download";
import { getPaper } from "../../../src/lib/papers";
import { publicUrl } from "../../../src/lib/storage";
import { colors } from "../../../src/theme/colors";

// 원본 PDF 보기 — 문제지 상세의 "원본 PDF". 필기 도구도 그대로 쓸 수 있다.
export default function PaperPdfScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [paper, setPaper] = useState<ExamPaper | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getPaper(String(id))
      .then((p) => {
        setPaper(p);
        // 화면에서 원본을 열어 본 것도 웹의 /download 라우트와 같은 카운트 대상이다.
        if (p?.file_path) countDownload(p.id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  async function saveOrShare() {
    if (!paper?.file_path) return;
    try {
      setSaving(true);
      await downloadAndOpenPdf(paper.id, paper.file_path, paper.file_name ?? paper.title);
    } catch {
      Alert.alert("내려받기 실패", "잠시 후 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  const fileUrl = paper?.file_path ? publicUrl(paper.file_path) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "원본 PDF",
          headerRight: () =>
            fileUrl ? (
              <Pressable onPress={saveOrShare} disabled={saving} hitSlop={8}>
                {saving ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={{ color: colors.primary, fontSize: 14, fontWeight: "600" }}>
                    저장·공유
                  </Text>
                )}
              </Pressable>
            ) : null,
        }}
      />
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
