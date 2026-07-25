import { Stack, useRootNavigationState, useRouter, useSegments } from "expo-router";
import type { ErrorBoundaryProps } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { isSupabaseConfigured, missingSupabaseEnv } from "../src/lib/env";
import { currentNickname } from "../src/lib/profile";
import { AuthProvider, useAuth } from "../src/providers/auth-provider";
import { colors } from "../src/theme/colors";

// 루트 레이아웃: 제스처 핸들러(핀치줌·필기용)와 인증 컨텍스트를 앱 전체에 깐다.
export default function RootLayout() {
  // 환경변수(Supabase)가 비어 있으면 어떤 화면도 데이터를 못 받는다. 예전처럼
  // 모듈 최상단에서 throw 하면 앱이 그냥 꺼지므로, 대신 무엇이 빠졌는지 보여준다.
  if (!isSupabaseConfigured) {
    return <ConfigErrorScreen missing={missingSupabaseEnv} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <NicknameGate />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="(auth)/login" options={{ presentation: "modal" }} />
            <Stack.Screen name="papers/[id]/index" options={{ headerShown: true, title: "" }} />
            <Stack.Screen name="papers/[id]/cbt" options={{ headerShown: true, title: "CBT" }} />
          </Stack>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// expo-router 가 렌더 중 발생한 예외를 여기로 보낸다. 이게 없으면 릴리스 빌드에서
// 예외 하나에 앱이 그대로 종료된다(사용자 눈엔 "켜자마자 꺼짐").
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "center" }}>
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 10 }}>
        문제가 발생했어요
      </Text>
      <ScrollView style={{ maxHeight: 260, marginBottom: 16 }}>
        <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 19 }}>
          {error?.message ?? "알 수 없는 오류"}
        </Text>
      </ScrollView>
      <Pressable
        onPress={retry}
        style={{
          backgroundColor: colors.primary,
          borderRadius: 10,
          paddingVertical: 12,
          alignItems: "center",
        }}
      >
        <Text style={{ color: colors.primaryText, fontWeight: "600" }}>다시 시도</Text>
      </Pressable>
    </View>
  );
}

function ConfigErrorScreen({ missing }: { missing: string[] }) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 24, justifyContent: "center" }}>
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 10 }}>
        앱 설정이 빠졌어요
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 12 }}>
        아래 환경변수 없이 빌드돼서 서버에 연결할 수 없어요. 값은 번들 시점에 박히므로
        빌드를 다시 해야 해요.
      </Text>
      {missing.map((name) => (
        <Text key={name} style={{ fontSize: 13, fontWeight: "600", marginBottom: 4 }}>
          • {name}
        </Text>
      ))}
      <Text style={{ color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 12 }}>
        로컬은 apps/mobile/.env, EAS 빌드는 EAS 환경변수(eas.json 의 environment)에
        넣어주세요. 자세한 건 apps/mobile/SETUP.md 참고.
      </Text>
    </View>
  );
}

// 소셜 로그인 후 닉네임이 없으면 온보딩(/nickname)으로 보낸다. 웹 auth 콜백이
// user_metadata.nickname 없으면 온보딩으로 보내는 것과 같은 규칙.
function NicknameGate() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  // 루트 네비게이터가 아직 안 붙었는데 replace 하면 예외가 난다("Attempted to
  // navigate before mounting the Root Layout"). 준비될 때까지 기다린다.
  const navState = useRootNavigationState();

  useEffect(() => {
    if (!navState?.key) return;
    if (loading || !session) return;
    if (currentNickname(session.user.user_metadata)) return;
    // 이미 닉네임/로그인 화면이면 두 번 보내지 않는다.
    const top = segments[0];
    if (top === "nickname" || top === "(auth)") return;
    router.replace("/nickname");
  }, [loading, session, segments, router, navState?.key]);

  return null;
}
