import { router, type Href } from "expo-router";
import { CalendarCheck, Lock } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 오답노트 탭 안 "오늘의 복습" 카드(웹 review-due-card.tsx, 설계서 §4.5 #26·§8.3). Phase 1a 에서는
// 잠긴 카드(무료 회원, 웹 LockedCard:390 1:1)와 프리미엄용 자리 표시만 그린다 — 실제 요약
// (EF review-due)·생성·설정·재개는 Phase 3 복습 스트림에서 붙는다.
const LockIcon = themedIcon(Lock);
const CalendarIcon = themedIcon(CalendarCheck);

export function ReviewDueCard({ premium }: { premium: boolean }) {
  if (!premium) return <LockedCard />;
  return (
    <View className="flex-row items-start gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3.5 dark:border-zinc-700 dark:bg-zinc-900">
      <CalendarIcon size={16} colorClassName="text-blue-600 dark:text-blue-400" />
      <View className="min-w-0 flex-1">
        <AppText variant="sm" weight="bold" className="text-zinc-700 dark:text-zinc-300">
          오늘의 복습
        </AppText>
        <AppText variant="xs" className="mt-0.5 text-zinc-500 dark:text-zinc-500" pretty>
          오늘의 복습은 다음 단계에서 열려요
        </AppText>
      </View>
    </View>
  );
}

// 무료 회원이 보는 자리. 잠겼다는 사실만 알리고 끝내면 어디로 가야 풀리는지 알 수 없어서,
// 카드 전체를 요금제 페이지 링크로 둔다.
function LockedCard() {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push("/membership?next=%2Fmypage%3Ftab%3Dwrong-notes" as Href)}
      className="flex-row items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3.5 active:border-blue-300 active:bg-blue-50/50 dark:border-zinc-700 dark:bg-zinc-800/50 dark:active:border-blue-800 dark:active:bg-blue-950/20"
    >
      <View className="mt-0.5">
        <LockIcon size={16} colorClassName="text-zinc-400 dark:text-zinc-500" />
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          <AppText variant="sm" weight="bold" className="text-zinc-700 dark:text-zinc-300">
            오늘의 복습
          </AppText>
          <View className="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5">
            <AppText variant="10" weight="bold" allowFontScaling={false} className="text-white">
              멤버십
            </AppText>
          </View>
        </View>
        <AppText variant="xs" className="mt-0.5 text-zinc-500 dark:text-zinc-500" pretty>
          공모아만의 특수 알고리즘이 틀린 문제를 가장 잊기 쉬운 순간에 다시 복습시켜줘요
        </AppText>
        <AppText variant="xs" weight="bold" className="mt-1.5 text-blue-600 dark:text-blue-400">
          멤버십 혜택 알아보기 ›
        </AppText>
      </View>
    </Pressable>
  );
}
