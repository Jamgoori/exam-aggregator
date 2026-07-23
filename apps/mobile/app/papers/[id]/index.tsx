import { Link, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
} from "react-native";
import { getPaper, hasCbtAnswers } from "../../../src/lib/papers";
import type { ExamPaper } from "../../../src/lib/types";
import { colors } from "../../../src/theme/colors";

// 문제지 상세: 메타 정보 + CBT 진입. 웹 papers/[id]/page.tsx 의 앱 최소판.
// 원본 PDF 뷰어/댓글/난이도는 이후 이식.
export default function PaperDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [paper, setPaper] = useState<ExamPaper | null>(null);
  const [cbt, setCbt] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([getPaper(id), hasCbtAnswers(id).catch(() => false)])
      .then(([p, c]) => {
        setPaper(p);
        setCbt(c);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!paper) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.textMuted }}>문제지를 찾을 수 없어요.</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: "700" }}>{paper.title}</Text>
      <Text style={{ color: colors.textMuted }}>
        {paper.year}년 {paper.round}회
        {paper.level ? ` · ${paper.level}` : ""}
        {paper.question_count ? ` · ${paper.question_count}문항` : ""}
      </Text>

      {cbt ? (
        <Link href={`/papers/${paper.id}/cbt`} asChild>
          <Pressable
            style={{
              backgroundColor: colors.primary,
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: "center",
              marginTop: 8,
            }}
          >
            <Text style={{ color: colors.primaryText, fontWeight: "600" }}>
              CBT로 풀기
            </Text>
          </Pressable>
        </Link>
      ) : (
        <Text style={{ color: colors.textMuted, marginTop: 8 }}>
          아직 CBT를 지원하지 않는 문제지예요.
        </Text>
      )}
    </View>
  );
}
