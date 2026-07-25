import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useColors, useIsDark } from "../src/theme/colors";
import { currentNickname } from "../src/lib/profile";
import { checkForUpdate } from "../src/lib/updates";
import { AuthProvider, useAuth } from "../src/providers/auth-provider";

// 루트 레이아웃: 제스처 핸들러(핀치줌·필기용)와 인증 컨텍스트를 앱 전체에 깐다.
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ThemedStack />
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// 상태바·헤더·탭 배경까지 테마를 따라가야 다크모드에서 흰 띠가 남지 않는다.
function ThemedStack() {
  const colors = useColors();
  const dark = useIsDark();

  // OTA: 켤 때 한 번, 그리고 포그라운드로 돌아올 때마다 확인한다. 받은 업데이트는 다음
  // 실행에 적용된다(풀던 화면을 날리지 않으려고 즉시 재시작하지 않음).
  useEffect(() => {
    checkForUpdate();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkForUpdate();
    });
    return () => sub.remove();
  }, []);
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <NicknameGate />
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)/login" options={{ presentation: "modal" }} />
        <Stack.Screen name="papers/[id]/index" options={{ headerShown: true, title: "" }} />
        <Stack.Screen name="papers/[id]/cbt" options={{ headerShown: true, title: "CBT" }} />
      </Stack>
    </>
  );
}

// 소셜 로그인 후 닉네임이 없으면 온보딩(/nickname)으로 보낸다. 웹 auth 콜백이
// user_metadata.nickname 없으면 온보딩으로 보내는 것과 같은 규칙.
function NicknameGate() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    if (loading || !session) return;
    if (currentNickname(session.user.user_metadata)) return;
    // 이미 닉네임/로그인 화면이면 두 번 보내지 않는다.
    const top = segments[0];
    if (top === "nickname" || top === "(auth)") return;
    router.replace("/nickname");
  }, [loading, session, segments, router]);

  return null;
}
