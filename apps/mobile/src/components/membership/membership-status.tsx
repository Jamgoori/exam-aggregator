import { router, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";

// 로그인한 사람에게 지금 자기 상태를 한 줄로(웹 membership/page.tsx CurrentStatus:211·StatusPill:262,
// 설계서 §8.1 여섯 가지 상태: 관리자/전면무료/체험 N일/출석 N일/프리미엄/무료).
export function StatusPill({ tone, children }: { tone: "blue" | "zinc"; children: string }) {
  const box = tone === "blue" ? "bg-blue-100 dark:bg-blue-950/60" : "bg-zinc-100 dark:bg-zinc-800";
  const text = tone === "blue" ? "text-blue-800 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-400";
  return (
    <View className={["self-center rounded-full px-3 py-1", box].join(" ")}>
      <AppText variant="xs" weight="bold" className={text}>
        {children}
      </AppText>
    </View>
  );
}

export function MembershipStatus({
  freeForAll,
  premium,
  admin,
  daysLeft,
  rewardDaysLeft,
  loggedIn,
}: {
  freeForAll: boolean;
  premium: boolean;
  admin: boolean;
  // 체험 만료까지 남은 일수(체험이 아니면 null).
  daysLeft: number | null;
  // 출석 보상으로 열린 기간의 남은 일수(그 출처가 아니면 null).
  rewardDaysLeft: number | null;
  loggedIn: boolean;
}) {
  if (!loggedIn) {
    return (
      <View className="flex-row flex-wrap items-center justify-center">
        <Pressable accessibilityRole="link" onPress={() => router.push("/login?next=%2Fmembership" as Href)} hitSlop={6}>
          <AppText variant="xs" weight="medium" className="text-blue-600 dark:text-blue-400">
            로그인
          </AppText>
        </Pressable>
        <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
          하면 지금 내 멤버십 상태를 볼 수 있어요.
        </AppText>
      </View>
    );
  }

  // 관리자는 멤버십과 무관하게 유료 기능을 쓴다 — "체험 N일 남음"을 보여주면 거짓말이 된다.
  if (admin) return <StatusPill tone="blue">관리자 계정 · 모든 기능 이용 중</StatusPill>;
  // 이벤트 기간에는 계정 상태를 따지지 않는다 — "N일 남음"을 띄우면 오히려 끊길 날을 걱정하게 만든다.
  if (freeForAll) return <StatusPill tone="blue">전면 무료 기간 · 모든 기능 이용 중</StatusPill>;
  if (premium && daysLeft != null) return <StatusPill tone="blue">{`무료 체험 중 · ${daysLeft}일 남음`}</StatusPill>;
  if (premium && rewardDaysLeft != null) return <StatusPill tone="blue">{`출석 보상 멤버십 · ${rewardDaysLeft}일 남음`}</StatusPill>;
  if (premium) return <StatusPill tone="blue">멤버십 이용 중</StatusPill>;
  return <StatusPill tone="zinc">현재 무료 회원</StatusPill>;
}
