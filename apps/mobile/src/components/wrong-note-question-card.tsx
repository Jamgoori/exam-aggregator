import { Image } from "expo-image";
import { Pressable, Text, View } from "react-native";
import type { WrongNoteQuestionSummary } from "@gongmoa/core";
import { MemoField } from "./memo-field";
import { useColors } from "../theme/colors";

// 오답노트 문항 카드. 정답은 표시하지 않는다 — paper_answers 는 RLS 로 클라이언트에
// 완전히 막혀 있고(커닝 방지), 극복 판정은 CBT/섞어풀기에서 서버가 채점한 결과를 쓴다.
// 화면에 나오는 건 문항 이미지·내가 마지막에 고른 답·틀린 횟수·극복 여부뿐이다.
export function WrongNoteQuestionCard({
  question,
  paperId,
  images,
  pinned,
  paperLabel,
  wrongRatePct,
  busy,
  showMemo = true,
  onZoom,
  onTogglePin,
  onDelete,
}: {
  question: WrongNoteQuestionSummary;
  paperId: string;
  images: string[];
  pinned: boolean;
  // 문항 모아보기에서 어느 문제지 문항인지 알려주는 줄. 문제지 화면에선 생략.
  paperLabel?: string;
  // 전국 오답률(%). 표본이 적으면 null 로 와서 배지를 그리지 않는다.
  wrongRatePct?: number | null;
  busy?: boolean;
  // 로그인 사용자만 메모가 의미 있다.
  showMemo?: boolean;
  onZoom: (uri: string) => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: colors.card,
      }}
    >
      <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 2 }}>
        {paperLabel && (
          <Text style={{ color: colors.textMuted, fontSize: 11 }} numberOfLines={1}>
            {paperLabel}
          </Text>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontWeight: "600" }}>{question.questionNumber}번</Text>
          {question.wrongCount > 1 && (
            <Text style={{ fontSize: 11, color: colors.danger }}>
              {question.wrongCount}번 틀림
            </Text>
          )}
          {wrongRatePct != null && (
            <Text style={{ fontSize: 11, color: colors.textMuted }}>
              전국 오답률 {wrongRatePct}%
            </Text>
          )}
          <View style={{ flex: 1 }} />
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: question.resolved ? colors.success : colors.danger,
            }}
          >
            {question.resolved ? "극복" : "미극복"}
          </Text>
        </View>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>
          {question.lastSelectedChoice == null
            ? "풀지 않고 넘어간 문제"
            : `마지막에 고른 답 ${question.lastSelectedChoice}번`}
        </Text>
      </View>

      {images.length === 0 ? (
        <Text style={{ color: colors.textMuted, fontSize: 12, padding: 12 }}>
          문항 이미지가 없어요.
        </Text>
      ) : (
        <View style={{ marginTop: 8 }}>
          {images.map((uri) => (
            <Pressable key={uri} onPress={() => onZoom(uri)}>
              <Image
                source={{ uri }}
                style={{ width: "100%", aspectRatio: 0.75 }}
                contentFit="contain"
                transition={100}
              />
            </Pressable>
          ))}
        </View>
      )}

      {showMemo && (
        <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
          <MemoField paperId={paperId} questionNumber={question.questionNumber} />
        </View>
      )}

      <View
        style={{
          flexDirection: "row",
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Pressable
          onPress={onTogglePin}
          disabled={busy}
          style={{ flex: 1, paddingVertical: 10, alignItems: "center" }}
        >
          <Text style={{ fontSize: 13, color: pinned ? colors.primary : colors.text }}>
            {pinned ? "★ 다시 볼 문제" : "☆ 다시 볼 문제"}
          </Text>
        </Pressable>
        <View style={{ width: 1, backgroundColor: colors.border }} />
        <Pressable
          onPress={onDelete}
          disabled={busy}
          style={{ flex: 1, paddingVertical: 10, alignItems: "center" }}
        >
          <Text style={{ fontSize: 13, color: colors.danger }}>오답노트에서 빼기</Text>
        </Pressable>
      </View>
    </View>
  );
}
