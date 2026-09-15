import { LinearGradient } from "expo-linear-gradient";
import { router, type Href } from "expo-router";
import { View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { useIsDark } from "../../theme";

// 무료 회원이 유료 기능 자리에서 보게 되는 안내 카드(웹 membership-upsell.tsx, 설계서 §4.5 #28).
// 웹의 "월 N원부터 · 1년 결제 시 N% 할인" 가격 줄은 Phase 5(IAP) 전까지 그리지 않는다
// (§8.1: 플랜 카드·가격·구매 버튼은 스토어 결제 정책상 앱에 두지 않는다).
export function MembershipUpsell({
  title,
  description,
  // 결제 페이지에서 돌아올 곳. 로그인 유도와 같은 방식으로 next 쿼리에 싣는다.
  next,
  className,
}: {
  title: string;
  description: string;
  next?: string;
  className?: string;
}) {
  const dark = useIsDark();
  const href = next ? `/membership?next=${encodeURIComponent(next)}` : "/membership";
  return (
    <LinearGradient
      colors={dark ? ["rgba(2,44,34,0.4)", "#18181b"] : ["#ecfdf5", "#ffffff"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      className={["items-center gap-3 rounded-2xl border border-blue-200 px-6 py-10 dark:border-blue-900/60", className ?? ""].join(" ")}
    >
      <AppText weight="bold" className="text-center text-zinc-900 dark:text-zinc-100">
        {title}
      </AppText>
      <AppText variant="sm" className="max-w-md text-center text-zinc-600 dark:text-zinc-400" pretty>
        {description}
      </AppText>
      <View className="mt-1">
        <Button label="멤버십 보러 가기" onPress={() => router.push(href as Href)} className="px-6" />
      </View>
    </LinearGradient>
  );
}
