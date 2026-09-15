import { avatarInitial } from "@gongmoa/core";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { View } from "react-native";
import { AppText } from "./app-text";
import { tokens } from "../theme";

// 계정 원형 아바타(웹 user-menu.tsx Avatar). 사진이 있으면 그것을, 없으면 닉네임 첫 글자
// (core avatarInitial) 를 from-blue-500 to-blue-600 그라데이션 위에 그린다 — 사진을 올린
// 계정이 소수라 "없을 때"가 기본값이다.
export type AvatarSize = "sm" | "md" | "lg" | "xl";

const BOX: Record<AvatarSize, { cls: string; px: number; text: "10" | "xs" | "sm" | "2xl" }> = {
  sm: { cls: "h-6 w-6", px: 24, text: "10" },
  md: { cls: "h-7 w-7", px: 28, text: "xs" },
  lg: { cls: "h-9 w-9", px: 36, text: "sm" },
  xl: { cls: "h-20 w-20", px: 80, text: "2xl" },
};

export function Avatar({
  nickname,
  avatarUrl = null,
  size = "md",
}: {
  nickname: string;
  avatarUrl?: string | null;
  size?: AvatarSize;
}) {
  const box = BOX[size];
  if (avatarUrl) {
    // expo-image 의 Image 는 Uniwind 가 감싸지 않아 className 이 버려진다 — 배경(로딩 중 자리)은
    // 바깥 View 에 주고 이미지에는 style 만 준다.
    return (
      <View
        className="shrink-0 overflow-hidden bg-zinc-100 dark:bg-zinc-800"
        style={{ width: box.px, height: box.px, borderRadius: box.px / 2 }}
      >
        <Image
          source={{ uri: avatarUrl }}
          cachePolicy="memory-disk"
          contentFit="cover"
          accessible={false}
          style={{ width: box.px, height: box.px, borderRadius: box.px / 2 }}
        />
      </View>
    );
  }
  return (
    <LinearGradient
      colors={[tokens.light.blue[500], tokens.light.blue[600]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      // LinearGradient 도 className 이 안 먹는다 — 가운데 정렬은 style 로.
      style={{ width: box.px, height: box.px, borderRadius: box.px / 2, alignItems: "center", justifyContent: "center" }}
    >
      <View accessible={false}>
        <AppText variant={box.text} weight="bold" allowFontScaling={false} className="text-white">
          {avatarInitial(nickname)}
        </AppText>
      </View>
    </LinearGradient>
  );
}

// 닉네임 옆 멤버십 배지 — 체험인지 결제인지 구분하지 않는다("지금 유료 기능을 쓸 수 있는가" 하나만).
export function MembershipBadge() {
  return (
    <View className="shrink-0 rounded-full bg-blue-600 px-1.5 py-0.5">
      <AppText variant="10" weight="bold" allowFontScaling={false} className="text-white">
        멤버십
      </AppText>
    </View>
  );
}
