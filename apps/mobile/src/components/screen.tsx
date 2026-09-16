import { Stack } from "expo-router";
import { BottomTabBarHeightContext } from "expo-router/tabs";
import { useCallback, useContext, useRef, useState } from "react";
import {
  FlatList,
  RefreshControl,
  ScrollView,
  View,
  type FlatListProps,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppFooter } from "./app-footer";
import { AppHeader } from "./app-header";
import { OfflineBanner } from "./offline-banner";
import { ReviewFab } from "./review/review-fab";
import { useIsOnline } from "../lib/net";

// 화면 셸(설계서 §3.5·§4.4). 배경은 토큰 `bg-background`(웹 --background: 라이트 #fff · 다크
// #0a0a0a) — `dark:bg-zinc-900` 을 덧붙이면 다크가 #18181b 로 웹과 어긋난다(CBT 풀이 루트만 zinc-900).
// 페이지 `px-4 pt-6 pb-12`, 헤더는 스크롤 밖 상단 고정, 푸터는
// 스크롤 끝. `immersive` 는 헤더·푸터·FAB·광고를 빼고 iOS 가장자리 스와이프·Android 예측
// 뒤로가기를 끈다(응시 이탈 확인은 화면이 자체 버튼 + Alert 로). 몰입 라우트는 (tabs) 그룹
// 밖(루트 Stack)에 두어 하단 탭도 자연히 빠진다. 폰 가로 폭에서는 1열 + max-w-[640px].
const IMMERSIVE_OPTIONS = { gestureEnabled: false, fullScreenGestureEnabled: false, headerShown: false } as const;

// 화면에 고정되는 겹침 요소(하단 선택 바·되돌리기 토스트)가 앉는 자리.
//
// 웹에서 `fixed bottom-4` 인 것들을 그대로 옮겨 놓으면 앱에서는 **뷰포트가 아니라 목록에**
// 붙는다 — 본문이 ScrollView 의 contentContainer 안에 있어서, RN 의 absolute 는 그 안쪽
// 콘텐츠 박스를 기준으로 잡힌다. 긴 목록에서는 바가 화면 한참 아래(스크롤을 끝까지 내려야
// 보이는 자리)로 밀려 사실상 사라진다. 그래서 겹침 요소는 본문이 아니라 이 슬롯으로 올려
// ScrollView **다음에** 루트 View 안에 그린다(= 뷰포트 고정 + 본문 위).
//
// 바닥 여백: 탭바가 있는 화면에서는 탭바가 이미 `paddingBottom: insets.bottom` 을 먹고 씬이
// 탭바 **위에서** 끝나므로(탭바는 absolute 가 아니라 형제 뷰다) 0 이고, 탭 밖(루트 Stack)
// 에서는 홈 인디케이터만큼 띄운다. 이 슬롯이 여백을 책임지므로 안에 들어가는 요소는 웹과
// 똑같은 `bottom-4`·`bottom-20` 클래스를 그대로 쓴다.
function useOverlayBottom(insetBottom: number): number {
  const tabBarHeight = useContext(BottomTabBarHeightContext);
  return tabBarHeight === undefined ? insetBottom : 0;
}

// 복습 FAB 이 뜨기 시작하는 스크롤 깊이(웹 review-fab.tsx SHOW_AFTER_PX 와 같은 값). 첫 화면에서
// 바로 튀어나오면 본문을 읽기도 전에 방해가 된다.
const FAB_SHOW_AFTER_PX = 400;

// 리렌더는 경계를 넘을 때만 — 스크롤 프레임마다 setState 하면 긴 목록에서 초당 수십 번 다시
// 그린다(Phase 2 검토에서 분할 바가 같은 이유로 걸렸다).
function useScrolledPast(px: number) {
  const [scrolled, setScrolled] = useState(false);
  const last = useRef(false);
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = e.nativeEvent.contentOffset.y > px;
      if (next === last.current) return;
      last.current = next;
      setScrolled(next);
    },
    [px],
  );
  return { scrolled, onScroll };
}

function ScreenOverlay({ children, bottom }: { children: React.ReactNode; bottom: number }) {
  return (
    <View pointerEvents="box-none" style={{ bottom }} className="absolute inset-x-0 top-0">
      {children}
    </View>
  );
}

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
  // 뷰포트에 고정되는 겹침 요소(하단 선택 바·UndoToast). ScreenOverlay 설명 참고 — 본문
  // 안에 두면 목록에 붙어 화면 밖으로 밀리므로 화면이 여기로 올려 준다.
  overlay,
  refreshing,
  onRefresh,
  className,
  contentClassName,
  ...shell
}: ShellProps & ScrollViewProps & { children?: React.ReactNode; overlay?: React.ReactNode }) {
  const { insets, online, showHeader, showFooter, pad } = useShell(shell);
  const { immersive } = shell;
  const overlayBottom = useOverlayBottom(insets.bottom);
  const { scrolled, onScroll } = useScrolledPast(FAB_SHOW_AFTER_PX);
  return (
    <View className={["flex-1 bg-background", className ?? ""].join(" ")} style={immersive ? { paddingTop: insets.top } : null}>
      {immersive && <Stack.Screen options={IMMERSIVE_OPTIONS} />}
      {showHeader && <AppHeader />}
      {immersive ? (
        <View className="flex-1">{children}</View>
      ) : (
        <ScrollView
          className="flex-1"
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={64}
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
      {/* 복습 FAB 은 overlay 슬롯보다 **먼저** 그린다 — 되돌리기 토스트·선택 바가 겹칠 때는
          그쪽이 위에 있어야 한다(방금 한 동작을 취소하는 자리가 더 급하다). */}
      {!immersive && <ScreenOverlay bottom={overlayBottom}><ReviewFab visible={scrolled} /></ScreenOverlay>}
      {overlay != null && <ScreenOverlay bottom={overlayBottom}>{overlay}</ScreenOverlay>}
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
  const { insets, online, showHeader, showFooter, pad } = useShell(props);
  const overlayBottom = useOverlayBottom(insets.bottom);
  const { scrolled, onScroll } = useScrolledPast(FAB_SHOW_AFTER_PX);
  return (
    <View className={["flex-1 bg-background", className ?? ""].join(" ")}>
      {showHeader && <AppHeader />}
      <FlatList
        {...props}
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        onScroll={onScroll}
        scrollEventThrottle={64}
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
      {!props.immersive && (
        <ScreenOverlay bottom={overlayBottom}>
          <ReviewFab visible={scrolled} />
        </ScreenOverlay>
      )}
    </View>
  );
}
