import { router, type Href } from "expo-router";
import { Lock } from "lucide-react-native";
import { View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { themedIcon } from "../../theme/icons";

const LockIcon = themedIcon(Lock);

// 무료 회원의 해설 자리에 들어가는 잠금 카드(웹 explanation-lock.tsx, 설계서 §4.5 #24).
// 흐린 줄은 진짜 해설이 아니라 자리 표시용 막대다 — 본문은 서버가 아예 내려주지 않는다.
// blur 3px + Lock 13 + 문구 + CTA "멤버십 보러 가기" → /membership?next=.
export function ExplanationLock({
  questionNumber,
  showNumber,
  // 결제 페이지에서 돌아올 곳.
  next,
}: {
  questionNumber: number;
  showNumber: boolean;
  next?: string;
}) {
  const href = next ? `/membership?next=${encodeURIComponent(next)}` : "/membership";
  return (
    <View className="relative overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800/50">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" className="gap-2 p-3" style={{ filter: [{ blur: 3 }] }}>
        <View className="h-3 w-1/3 rounded bg-zinc-300 dark:bg-zinc-600" />
        <View className="h-3 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
        <View className="h-3 w-11/12 rounded bg-zinc-200 dark:bg-zinc-700" />
        <View className="h-3 w-3/4 rounded bg-zinc-200 dark:bg-zinc-700" />
      </View>

      <View className="absolute inset-0 items-center justify-center gap-1.5 bg-white/70 px-4 dark:bg-zinc-900/70">
        <View className="flex-row items-center gap-1.5">
          <LockIcon size={13} colorClassName="text-zinc-700 dark:text-zinc-300" />
          <AppText variant="xs" weight="semibold" className="text-center text-zinc-700 dark:text-zinc-300">
            {showNumber ? `${questionNumber}번 해설은 멤버십에서 볼 수 있어요` : "해설은 멤버십에서 볼 수 있어요"}
          </AppText>
        </View>
        <Button
          label="멤버십 보러 가기"
          onPress={() => router.push(href as Href)}
          className="rounded-lg px-3 py-1.5"
          textClassName="text-xs font-bold"
        />
      </View>
    </View>
  );
}
