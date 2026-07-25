import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { getPaperDisplayTitle, type ExamPaper } from "@gongmoa/core";
import { roundBadge } from "../lib/round-tier";
import { examTypeBadge, levelBadge } from "../theme/badges";
import { useColors } from "../theme/colors";

// 문제지 카드. 웹 components/exam-card.tsx 와 같은 구성으로 맞춘다 —
// 위: 급수·직렬·회독 배지 + 즐겨찾기 별 / 가운데: 제목 / 아래: 구분선 + 바로 풀기·자세히 보기.
// 배지 색도 웹과 같은 값(theme/badges)이라 같은 문제지가 양쪽에서 같은 색으로 보인다.
export function ExamCard({
  paper,
  myRoundCount,
  bookmarked = false,
  cbtAvailable = false,
  onToggleBookmark,
}: {
  paper: ExamPaper;
  myRoundCount?: number;
  bookmarked?: boolean;
  cbtAvailable?: boolean;
  // 로그인 안 했으면 넘기지 않는다 — 별을 아예 그리지 않는다(웹도 비로그인은 안 보여줌).
  onToggleBookmark?: () => void;
}) {
  const colors = useColors();
  const router = useRouter();

  const title = getPaperDisplayTitle(paper.title, paper.track);
  const level = paper.level;
  const examType = paper.exam_types;
  const round = myRoundCount ?? 0;
  const tier = round > 0 ? roundBadge(round) : null;

  return (
    <Pressable
      onPress={() => router.push(`/papers/${paper.id}`)}
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        backgroundColor: colors.card,
        padding: 14,
        gap: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {level && <Chip text={level} {...levelBadge(level)} />}
          {examType?.name && <Chip text={examType.name} {...examTypeBadge(examType.name)} />}
          {tier && <Chip text={`${round}회독`} bg={tier.bg} fg={tier.fg} rounded />}
        </View>

        {onToggleBookmark && (
          <Pressable onPress={onToggleBookmark} hitSlop={10}>
            <Text style={{ fontSize: 18, color: bookmarked ? "#f59e0b" : colors.border }}>
              {bookmarked ? "★" : "☆"}
            </Text>
          </Pressable>
        )}
      </View>

      <Text style={{ fontWeight: "500", fontSize: 15, lineHeight: 21 }}>{title}</Text>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingTop: 10,
        }}
      >
        {cbtAvailable && (
          <Pressable
            onPress={() => router.push(`/papers/${paper.id}/cbt`)}
            hitSlop={6}
            style={{
              borderWidth: 1,
              borderColor: colors.primary,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "500" }}>
              바로 풀기
            </Text>
          </Pressable>
        )}
        <Text
          style={{
            marginLeft: "auto",
            color: colors.primary,
            fontSize: 12,
            fontWeight: "500",
          }}
        >
          자세히 보기 ›
        </Text>
      </View>
    </Pressable>
  );
}

function Chip({
  text,
  bg,
  fg,
  rounded,
}: {
  text: string;
  bg: string;
  fg: string;
  rounded?: boolean;
}) {
  return (
    <Text
      style={{
        fontSize: 11,
        fontWeight: "700",
        color: fg,
        backgroundColor: bg,
        borderRadius: rounded ? 999 : 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        overflow: "hidden",
      }}
    >
      {text}
    </Text>
  );
}
