import { FREE_UNTIL_LABEL, TRIAL_DAYS } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { palette } from "../../theme";

// 마무리 CTA(웹 page.tsx ClosingCta). 이벤트 문구는 core 상수에서.
export function ClosingCta({ freeForAll }: { freeForAll: boolean }) {
  return (
    <View className="bg-[#e7f2fc]/40 dark:bg-zinc-900/60">
      <View className="items-center px-4 py-14">
        <AppText variant="2xl" weight="bold" accessibilityRole="header" className="text-center tracking-tight text-zinc-900 dark:text-zinc-50">
          공모아에서 합격을 준비하세요
        </AppText>
        <AppText variant="sm" className="mt-2 text-center text-zinc-500 dark:text-zinc-400" pretty>
          {freeForAll
            ? `${FREE_UNTIL_LABEL}까지 결제 없이 모든 기능을 쓸 수 있어요.`
            : `가입 후 ${TRIAL_DAYS}일 동안 결제 없이 모든 기능을 쓸 수 있어요.`}
        </AppText>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/papers" as Href)}
          className="mt-6 flex-row items-center gap-2 rounded-lg bg-[#012854] px-6 py-3.5 shadow-lg shadow-[#012854]/15 active:opacity-90 dark:bg-[#0a7d5b] dark:shadow-black/30"
        >
          <AppText variant="sm" weight="bold" className="text-white">
            무료로 시작하기
          </AppText>
          <ArrowRight size={16} color={palette.white} />
        </Pressable>
      </View>
    </View>
  );
}
