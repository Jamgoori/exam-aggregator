import { ACCOUNT_NAV, PRIMARY_NAV, type NavItemData } from "@gongmoa/core";
import { LinearGradient } from "expo-linear-gradient";
import { router, usePathname, type Href } from "expo-router";
import { GraduationCap, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Dimensions, Modal, Pressable, ScrollView, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./app-text";
import { Avatar, MembershipBadge } from "./avatar";
import { LoginLink } from "./login-link";
import { SignOutButton } from "./sign-out-button";
import { closeDrawer, useDrawerOpen } from "../lib/drawer-store";
import { useAuth } from "../providers/auth-provider";
import { NAV_THEMED_ICONS, themedIcon } from "../theme/icons";
import { useIsDark } from "../theme";

// 햄버거 → 오른쪽에서 밀려 나오는 서랍(웹 mobile-nav.tsx, 설계서 §4.4). 항목 데이터는 core
// nav-items.ts — 탭에 있는 항목도 드로어에서 빠지지 않는다(소유자 결정 §12-2 1번).
// 관리자 항목은 렌더하지 않는다. 계정 섹션·로그아웃은 user 가 있을 때만.
const DRAWER_EASING = Easing.bezier(0.16, 1, 0.3, 1);
const CloseIcon = themedIcon(X);

// href 는 웹 경로 그대로. 아직 이식되지 않은 목적지는 expo-router 가 +not-found 로 보낸다.
function go(href: string) {
  closeDrawer();
  router.push(href as Href);
}

export function NavDrawer() {
  const open = useDrawerOpen();
  const [mounted, setMounted] = useState(open);
  const width = Dimensions.get("window").width;
  const x = useSharedValue(width);
  const fade = useSharedValue(0);

  // 열리면 같은 렌더에서 마운트(Sheet 와 같은 패턴), 닫힘은 퇴장 애니메이션 뒤 콜백에서.
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      fade.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.ease) });
      x.value = withTiming(0, { duration: 260, easing: DRAWER_EASING });
    } else if (mounted) {
      fade.value = withTiming(0, { duration: 160 });
      x.value = withTiming(width, { duration: 200, easing: Easing.in(Easing.ease) }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  if (!mounted) return null;

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={closeDrawer}>
      <View className="flex-1 flex-row justify-end" accessibilityViewIsModal accessibilityLabel="사이트 메뉴">
        <Animated.View style={overlayStyle} className="absolute inset-0 bg-zinc-900/40 dark:bg-black/60">
          <Pressable accessibilityLabel="메뉴 닫기" accessibilityRole="button" onPress={closeDrawer} className="flex-1" />
        </Animated.View>
        <Animated.View
          style={panelStyle}
          className="h-full w-[86%] max-w-[20rem] bg-white shadow-2xl dark:bg-zinc-900"
        >
          <DrawerContent />
        </Animated.View>
      </View>
    </Modal>
  );
}

function DrawerContent() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { user, nickname, avatarUrl, isPremium } = useAuth();
  const dark = useIsDark();
  const accountGradient = dark
    ? (["rgba(2,44,34,0.4)", "rgba(2,44,34,0.1)"] as const)
    : (["#ecfdf5", "rgba(236,253,245,0.3)"] as const);

  return (
    <View className="flex-1" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <View className="flex-row items-center justify-between border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <Pressable accessibilityRole="link" accessibilityLabel="공모아 홈" onPress={() => go("/")} className="flex-row items-center gap-2">
          <View className="h-8 w-8 items-center justify-center rounded-lg bg-[#12b382]">
            <GraduationCap size={18} color="#ffffff" />
          </View>
          <AppText variant="lg" weight="bold" allowFontScaling={false} className="text-[#12b382]">
            공모아
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="메뉴 닫기"
          onPress={closeDrawer}
          className="-mr-1 h-9 w-9 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
        >
          <CloseIcon size={19} colorClassName="text-zinc-400" />
        </Pressable>
      </View>

      <ScrollView className="min-h-0 flex-1" contentContainerClassName="px-3 py-3" overScrollMode="never">
        {user ? (
          <Pressable accessibilityRole="link" onPress={() => go("/mypage")}>
            <LinearGradient
              colors={accountGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              className="flex-row items-center gap-3 rounded-2xl px-3.5 py-3"
            >
              <Avatar nickname={nickname} avatarUrl={avatarUrl} size="lg" />
              <View className="min-w-0 flex-1">
                <View className="flex-row items-center gap-1.5">
                  <AppText variant="sm" weight="bold" numberOfLines={1} className="shrink">
                    {nickname}님
                  </AppText>
                  {isPremium && <MembershipBadge />}
                </View>
                <AppText variant="11" className="text-blue-600 dark:text-blue-400">
                  마이페이지 보기
                </AppText>
              </View>
            </LinearGradient>
          </Pressable>
        ) : (
          <LinearGradient
            colors={accountGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            className="rounded-2xl px-3.5 py-3.5"
          >
            <AppText variant="13" weight="medium" pretty className="text-zinc-600 dark:text-zinc-300">
              로그인하면 틀린 문제가 오답노트에 자동으로 쌓여요.
            </AppText>
            <LoginLink
              onPress={closeDrawer}
              className="mt-2.5 w-full flex-row items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-2.5 active:bg-blue-700"
            />
          </LinearGradient>
        )}

        <SectionLabel>메뉴</SectionLabel>
        <View className="gap-0.5">
          {PRIMARY_NAV.map((item) => (
            <PrimaryRow key={item.href} item={item} active={item.match(pathname ?? "")} />
          ))}
        </View>

        {user && (
          <>
            <SectionLabel>내 학습·계정</SectionLabel>
            <View className="gap-0.5">
              {ACCOUNT_NAV.flat().map((item) => (
                <AccountRow key={item.href} item={item} active={item.match(pathname ?? "")} />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {user && (
        <View className="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
          <SignOutButton onDone={closeDrawer} />
        </View>
      )}
    </View>
  );
}

function PrimaryRow({ item, active }: { item: NavItemData; active: boolean }) {
  const Icon = NAV_THEMED_ICONS[item.icon];
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      onPress={() => go(item.href)}
      className={[
        "flex-row items-center gap-3 rounded-xl px-3 py-2.5",
        active ? "bg-blue-50 dark:bg-blue-950/40" : "active:bg-zinc-100 dark:active:bg-zinc-800",
      ].join(" ")}
    >
      <Icon size={18} colorClassName={active ? "text-blue-600 dark:text-blue-400" : "text-zinc-400"} />
      <View className="min-w-0 flex-1">
        <AppText variant="sm" weight="semibold" className={active ? "text-blue-700 dark:text-blue-300" : ""}>
          {item.label}
        </AppText>
        {item.hint && (
          <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
            {item.hint}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

function AccountRow({ item, active }: { item: NavItemData; active: boolean }) {
  const Icon = NAV_THEMED_ICONS[item.icon];
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      onPress={() => go(item.href)}
      className={[
        "flex-row items-center gap-3 rounded-xl px-3 py-2",
        active ? "bg-blue-50 dark:bg-blue-950/40" : "active:bg-zinc-100 dark:active:bg-zinc-800",
      ].join(" ")}
    >
      <Icon size={17} colorClassName="text-zinc-400" />
      <AppText
        variant="sm"
        weight="medium"
        className={active ? "text-blue-700 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-300"}
      >
        {item.label}
      </AppText>
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <AppText
      variant="11"
      weight="bold"
      className="mt-4 mb-1.5 px-3 uppercase tracking-wide text-zinc-400 dark:text-zinc-500"
    >
      {children}
    </AppText>
  );
}
