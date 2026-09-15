import { router, type Href } from "expo-router";
import { ChevronRight, Trophy } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { DiagnosisProgress } from "../diagnosis/diagnosis-progress";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 상단 "다음 행동" 카드(웹 mypage/page.tsx NextActionCard:499, 설계서 §4.5 #26). 상태 기계는 셋뿐:
//   응시 0회   → 첫 모의고사 풀기(/papers)
//   자격 미달  → 진단까지 진행 바(응시 N/3 또는 오답 N/15)
//   자격 충족  → 진단 받기 / 이번 주 진단 보기 / 준비 중(요청은 했고 생성 대기)
const ChevronIcon = themedIcon(ChevronRight);

export function NextActionCard({
  attemptCount,
  wrongCount,
  weeklyStatus,
}: {
  attemptCount: number;
  wrongCount: number;
  weeklyStatus: "ready" | "pending" | null;
}) {
  if (attemptCount === 0) {
    return (
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push("/papers" as Href)}
        className="flex-row items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3.5 active:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/30 dark:active:bg-blue-950/50"
      >
        <View className="h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600">
          <Trophy size={16} color="#ffffff" />
        </View>
        <View className="min-w-0 flex-1">
          <AppText variant="sm" weight="bold" className="text-blue-900 dark:text-blue-100">
            첫 모의고사를 풀어보세요
          </AppText>
          <AppText variant="xs" className="text-blue-700/80 dark:text-blue-300/70" pretty>
            제출 즉시 채점 · 틀린 문제는 오답노트에 자동 저장
          </AppText>
        </View>
        <ChevronIcon size={16} colorClassName="text-blue-400" />
      </Pressable>
    );
  }
  const eligibleLabel =
    weeklyStatus === "ready"
      ? "이번 주 약점 진단 보기"
      : weeklyStatus === "pending"
        ? "약점 진단 준비 중 · 개념 그래프 먼저 보기"
        : "AI 약점 진단 받기";
  return <DiagnosisProgress attemptCount={attemptCount} wrongCount={wrongCount} eligibleLabel={eligibleLabel} />;
}
