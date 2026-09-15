import { router } from "expo-router";
import { GraduationCap, Menu } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./app-text";
import { Skeleton } from "./skeleton";
import { ThemeToggle } from "./theme-toggle";
import { openDrawer } from "../lib/drawer-store";
import { useAuth } from "../providers/auth-provider";
import { themedIcon } from "../theme/icons";

// 사이트 공통 헤더 = 메뉴바(웹 site-header.tsx, 설계서 §4.4). 높이 65(64 + 테두리 1).
// 모든 화면에서 동일("메뉴는 한 곳") — 스택 뒤로가기는 헤더에 넣지 않고 페이지 안 크럼 +
// 시스템 제스처로. 알림 종(NotificationBell)은 Phase 4 — 자리만 비워 둔다.
const MenuIcon = themedIcon(Menu);

export const HEADER_HEIGHT = 65;

export function AppHeader() {
  const insets = useSafeAreaInsets();
  const { loading } = useAuth();
  return (
    <View
      style={{ paddingTop: insets.top }}
      className="z-30 border-b border-zinc-200 bg-white/85 dark:border-zinc-700 dark:bg-zinc-950/85"
    >
      <View className="h-16 flex-row items-center gap-1 px-4">
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="공모아 홈"
          // 로고는 언제나 홈(랜딩)으로 간다. 목록 1페이지 되돌리기는 드로어의 "기출문제"가 맡는다.
          onPress={() => router.navigate("/")}
          className="mr-1 flex-row items-center gap-2 rounded-lg"
        >
          {/* 로고 색은 홈(랜딩) 팔레트(초록 accent) — 사이트 안 도구 화면의 파랑과 달리
              로고는 어느 화면에서나 브랜드 하나만 가리킨다. */}
          <View className="h-10 w-10 items-center justify-center rounded-lg bg-[#12b382] shadow-sm shadow-[#12b382]/30">
            <GraduationCap size={22} color="#ffffff" />
          </View>
          <AppText variant="2xl" weight="bold" allowFontScaling={false} className="text-[#12b382]">
            공모아
          </AppText>
        </Pressable>

        <View className="ml-auto flex-row items-center gap-1.5">
          {/* NotificationBell 자리(로그인 시, Phase 4) */}
          <ThemeToggle />
          {loading ? (
            // 인증 확정 전. 실제로 들어올 햄버거 버튼과 같은 크기라 헤더가 출렁이지 않는다.
            <Skeleton className="h-9 w-9 rounded-full" />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="메뉴 열기"
              onPress={openDrawer}
              className="h-9 w-9 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
            >
              <MenuIcon size={20} colorClassName="text-zinc-600 dark:text-zinc-300" />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
