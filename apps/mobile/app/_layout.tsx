import "../global.css";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Directory, Paths } from "expo-file-system";
import { Stack, useRouter, useSegments, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { FatalErrorScreen } from "../src/components/fatal-error-screen";
import { ForceUpdateScreen } from "../src/components/force-update-screen";
import { NavDrawer } from "../src/components/nav-drawer";
import { useAppConfigGate } from "../src/lib/app-config";
import { kvGet, kvSet } from "../src/lib/kv";
import { currentNickname } from "../src/lib/profile";
import { bindQueryManagers, buildPersistOptions, queryClient } from "../src/lib/query-client";
import { captureException, initSentry } from "../src/lib/sentry";
import { supabaseConfigError } from "../src/lib/supabase";
import { checkForUpdate } from "../src/lib/updates";
import { AuthProvider, useAuth } from "../src/providers/auth-provider";
import { useIsDark, useThemePreference } from "../src/theme";

// 모듈 로드 시 한 번: 크래시 리포팅, onlineManager ← NetInfo, focusManager ← AppState.
initSentry();
bindQueryManagers();

// expo-router 규약: 라우트 파일이 ErrorBoundary 를 내보내면 그 구간에서 난 렌더 오류를
// 여기서 받는다. 루트 레이아웃에 두었으므로 앱 어디서 터져도 이 화면이 뜬다.
//
// 릴리스 빌드에서 JS 예외는 원래 아무 설명 없이 앱을 종료시킨다("앱이 계속 중단됨").
// 원인을 보려면 adb logcat 이 필요한데 폰만 있으면 못 한다. 그래서 오류 메시지와
// 스택을 화면에 그려 스크린샷만으로 원인이 전달되게 하고, Sentry 에도 보낸다.
export function ErrorBoundary({ error }: ErrorBoundaryProps) {
  useEffect(() => {
    captureException(error);
  }, [error]);
  return (
    <FatalErrorScreen
      title="앱에서 오류가 발생했어요"
      message={error?.message ?? "알 수 없는 오류"}
      detail={error?.stack}
      hint="이 화면을 캡처해 전달해 주세요. 아래 내용을 길게 눌러 복사할 수도 있어요."
    />
  );
}

// 루트 레이아웃(설계서 §5 루트 행): Providers·QueryClient·persister·ErrorBoundary·ForceUpdate 게이트.
export default function RootLayout() {
  // 빌드에 Supabase 주소·키가 안 들어간 경우. 예전에는 supabase.ts 가 import 단계에서
  // throw 해서 앱이 화면도 없이 꺼졌다 — 무엇이 빠졌는지 보여주고 살려둔다.
  if (supabaseConfigError) {
    return (
      <FatalErrorScreen
        title="설정이 빠진 빌드예요"
        message={supabaseConfigError}
        hint={
          "이 빌드는 서버에 연결할 수 없어요. GitHub Actions 로 다시 빌드하면 " +
          "저장소 시크릿에서 값이 자동으로 들어갑니다."
        }
      />
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <QueryProviders>
            <Gates />
          </QueryProviders>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// 퍼시스터 buster 에 userId 를 섞어(§6.5) 계정이 바뀌면 이전 블롭이 복원되지 않게 한다.
function QueryProviders({ children }: { children: React.ReactNode }) {
  const { userId, loading } = useAuth();
  const persistOptions = useMemo(() => buildPersistOptions(userId), [userId]);
  // 인증 판정 전에는 anon buster 로 복원했다가 로그인 사용자 blob 을 다시 버스트하지 않도록
  // 세션 확정 뒤에 마운트한다.
  if (loading) return null;
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {children}
    </PersistQueryClientProvider>
  );
}

function Gates() {
  const gate = useAppConfigGate();
  useThemePreference();
  const dark = useIsDark();

  // OTA: 켤 때 한 번, 그리고 포그라운드로 돌아올 때마다 확인한다. 받은 업데이트는 다음
  // 실행에 적용된다(풀던 화면을 날리지 않으려고 즉시 재시작하지 않음).
  useEffect(() => {
    void checkForUpdate();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkForUpdate();
    });
    return () => sub.remove();
  }, []);

  // 구 앱(SDK 52)의 파일 캐시 gongmoa-cache/ 를 첫 실행에 1회 정리(§10, kv `migrated-v2`).
  useEffect(() => {
    (async () => {
      if ((await kvGet("migrated-v2")) === "1") return;
      try {
        const legacy = new Directory(Paths.cache, "gongmoa-cache");
        if (legacy.exists) legacy.delete();
      } catch {
        // 없거나 못 지워도 앱 동작과 무관하다.
      }
      await kvSet("migrated-v2", "1");
    })();
  }, []);

  if (gate.updateRequired) {
    return (
      <>
        <StatusBar style={dark ? "light" : "dark"} />
        <ForceUpdateScreen message={gate.message} storeUrl={gate.storeUrl} />
      </>
    );
  }

  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <NicknameGate />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: dark ? "#18181b" : "#ffffff" } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" options={{ presentation: "modal" }} />
        <Stack.Screen
          name="onboarding/nickname"
          options={{ presentation: "modal", gestureEnabled: false, fullScreenGestureEnabled: false }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>
      <NavDrawer />
    </>
  );
}

// 소셜 로그인 후 닉네임이 없으면 온보딩(/onboarding/nickname)으로 보낸다. 웹 auth 콜백이
// user_metadata.nickname 없으면 온보딩으로 보내는 것과 같은 규칙.
function NicknameGate() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading || !session) return;
    if (currentNickname(session.user.user_metadata)) return;
    // 이미 닉네임/로그인 화면이면 두 번 보내지 않는다.
    const top = segments[0] as string | undefined;
    if (top === "onboarding" || top === "login") return;
    router.replace("/onboarding/nickname");
  }, [loading, session, segments, router]);

  return null;
}
