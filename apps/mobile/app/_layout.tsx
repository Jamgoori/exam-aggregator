import { Stack, useRouter, useSegments, type ErrorBoundaryProps } from "expo-router";
import { useEffect } from "react";
import { AppState } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useColors, useIsDark } from "../src/theme/colors";
import { currentNickname } from "../src/lib/profile";
import { checkForUpdate } from "../src/lib/updates";
import { supabaseConfigError } from "../src/lib/supabase";
import { FatalErrorScreen } from "../src/components/fatal-error-screen";
import { AuthProvider, useAuth } from "../src/providers/auth-provider";

// expo-router 규약: 라우트 파일이 ErrorBoundary 를 내보내면 그 구간에서 난 렌더 오류를
// 여기서 받는다. 루트 레이아웃에 두었으므로 앱 어디서 터져도 이 화면이 뜬다.
//
// 릴리스 빌드에서 JS 예외는 원래 아무 설명 없이 앱을 종료시킨다("앱이 계속 중단됨").
// 원인을 보려면 adb logcat 이 필요한데 폰만 있으면 못 한다. 그래서 오류 메시지와
// 스택을 화면에 그려 스크린샷만으로 원인이 전달되게 한다.
export function ErrorBoundary({ error }: ErrorBoundaryProps) {
  return (
    <FatalErrorScreen
      title="앱에서 오류가 발생했어요"
      message={error?.message ?? "알 수 없는 오류"}
      detail={error?.stack}
      hint="이 화면을 캡처해 전달해 주세요. 아래 내용을 길게 눌러 복사할 수도 있어요."
    />
  );
}

// 루트 레이아웃: 제스처 핸들러(핀치줌·필기용)와 인증 컨텍스트를 앱 전체에 깐다.
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
