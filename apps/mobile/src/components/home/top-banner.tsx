import { FREE_UNTIL_LABEL, TRIAL_DAYS } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 상단 띠(웹 page.tsx TopBanner). 지금 이 사이트에 온 사람이 가장 먼저 알아야 할 한 줄 —
// 이벤트 중에는 "전부 무료", 끝난 뒤에는 체험 기간. 날짜·기간은 core 상수에서 온다.
// 한 줄로 읽혀야 한다(numberOfLines 1) — 두 줄이 되면 히어로를 밀어낸다.
const ChevronIcon = themedIcon(ChevronRight);

export function TopBanner({ freeForAll }: { freeForAll: boolean }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.push("/membership" as Href)}
      className="border-b border-zinc-200 bg-[#e7f2fc]/60 active:opacity-80 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <View className="flex-row items-center justify-center gap-1.5 px-3 py-2">
        <View className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#12b382]" />
        <AppText
          variant="11"
          weight="medium"
          numberOfLines={1}
          className="min-w-0 shrink text-zinc-600 dark:text-zinc-400"
          style={{ letterSpacing: -0.22 }}
        >
          {freeForAll
            ? `${FREE_UNTIL_LABEL}까지 멤버십 전 기능 무료, 로그인만 하면 돼요`
            : `가입하면 ${TRIAL_DAYS}일 동안 멤버십 전 기능 무료`}
        </AppText>
        <ChevronIcon size={14} colorClassName="text-zinc-600 dark:text-zinc-400" />
      </View>
    </Pressable>
  );
}
