import { Stack } from "expo-router";
import { FlatList, RefreshControl, ScrollView, View, type FlatListProps, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppFooter } from "./app-footer";
import { AppHeader } from "./app-header";
import { OfflineBanner } from "./offline-banner";
import { useIsOnline } from "../lib/net";

// 화면 셸(설계서 §3.5·§4.4). 페이지 `px-4 pt-6 pb-12`, 헤더는 스크롤 밖 상단 고정, 푸터는
// 스크롤 끝. `immersive` 는 헤더·푸터·FAB·광고를 빼고 iOS 가장자리 스와이프·Android 예측
// 뒤로가기를 끈다(응시 이탈 확인은 화면이 자체 버튼 + Alert 로). 몰입 라우트는 (tabs) 그룹
// 밖(루트 Stack)에 두어 하단 탭도 자연히 빠진다. 폰 가로 폭에서는 1열 + max-w-[640px].
const IMMERSIVE_OPTIONS = { gestureEnabled: false, fullScreenGestureEnabled: false, headerShown: false } as const;

type ShellProps = {
  immersive?: boolean;
  // 헤더/푸터를 개별로 끌 때(모달 화면 등).
  header?: boolean;
  footer?: boolean;
  padded?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  className?: string;
  contentClassName?: string;
};

function useShell({ immersive, header = true, footer = true, padded = true }: ShellProps) {
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const showHeader = !immersive && header;
  const showFooter = !immersive && footer;
  const pad = padded ? "px-4 pt-6 pb-12" : "";
  return { insets, online, showHeader, showFooter, pad };
}

export function Screen({
  children,
  refreshing,
  onRefresh,
  className,
  contentClassName,
  ...shell
}: ShellProps & ScrollViewProps & { children?: React.ReactNode }) {
  const { insets, online, showHeader, showFooter, pad } = useShell(shell);
  const { immersive } = shell;
  return (
    <View className={["flex-1 bg-background dark:bg-zinc-900", className ?? ""].join(" ")} style={immersive ? { paddingTop: insets.top } : null}>
      {immersive && <Stack.Screen options={IMMERSIVE_OPTIONS} />}
      {showHeader && <AppHeader />}
      {immersive ? (
        <View className="flex-1">{children}</View>
      ) : (
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
          }
        >
          <View className={["w-full max-w-[640px] self-center", pad, contentClassName ?? ""].join(" ")}>
            <OfflineBanner visible={!online} />
            {children}
          </View>
          {showFooter && <AppFooter />}
        </ScrollView>
      )}
    </View>
  );
}

// FlatList 판. 헤더는 고정, 목록 위 요소는 ListHeaderComponent 로.
export function ScreenList<T>({
  refreshing,
  onRefresh,
  className,
  contentClassName,
  ListFooterComponent,
  ...props
}: ShellProps & FlatListProps<T>) {
  const { online, showHeader, showFooter, pad } = useShell(props);
  return (
    <View className={["flex-1 bg-background dark:bg-zinc-900", className ?? ""].join(" ")}>
      {showHeader && <AppHeader />}
      <FlatList
        {...props}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerClassName={["w-full max-w-[640px] self-center", pad, contentClassName ?? ""].join(" ")}
        ListHeaderComponent={
          <>
            <OfflineBanner visible={!online} />
            {props.ListHeaderComponent as React.ReactNode}
          </>
        }
        ListFooterComponent={
          <>
            {ListFooterComponent as React.ReactNode}
            {showFooter && <AppFooter />}
          </>
        }
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
      />
    </View>
  );
}
