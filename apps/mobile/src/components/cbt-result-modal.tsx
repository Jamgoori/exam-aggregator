import { Modal, Pressable, Text, View } from "react-native";
import type { CbtSubmitResult } from "../lib/cbt";
import { formatDuration } from "@gongmoa/core";
import { useColors } from "../theme/colors";

// 웹 cbt-result-modal 의 앱판. 점수·소요시간 요약 + 다시 풀기/닫기.
export function CbtResultModal({
  result,
  onRetry,
  onClose,
}: {
  result: CbtSubmitResult;
  onRetry: () => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const percent = result.totalQuestions
    ? Math.round((result.score / result.totalQuestions) * 100)
    : 0;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 360,
            backgroundColor: colors.bg,
            borderRadius: 16,
            padding: 24,
            gap: 12,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700", textAlign: "center" }}>
            채점 결과
          </Text>
          <Text
            style={{
              fontSize: 40,
              fontWeight: "800",
              textAlign: "center",
              color: colors.primary,
            }}
          >
            {result.score}
            <Text style={{ fontSize: 20, color: colors.textMuted }}>
              {" "}
              / {result.totalQuestions}
            </Text>
          </Text>
          <Text style={{ textAlign: "center", color: colors.textMuted }}>
            정답률 {percent}% · 소요 {formatDuration(result.durationSeconds)}
          </Text>
          {result.voidedQuestions.length > 0 && (
            <Text style={{ textAlign: "center", color: colors.textMuted, fontSize: 12 }}>
              전항/복수정답 처리: {result.voidedQuestions.join(", ")}번
            </Text>
          )}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
            <Pressable
              onPress={onRetry}
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                paddingVertical: 12,
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "500" }}>다시 풀기</Text>
            </Pressable>
            <Pressable
              onPress={onClose}
              style={{
                flex: 1,
                backgroundColor: colors.primary,
                borderRadius: 10,
                paddingVertical: 12,
                alignItems: "center",
              }}
            >
              <Text style={{ color: colors.primaryText, fontWeight: "600" }}>확인</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
