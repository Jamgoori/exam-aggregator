import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../src/providers/auth-provider";

// 루트 레이아웃: 제스처 핸들러(핀치줌·필기용)와 인증 컨텍스트를 앱 전체에 깐다.
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <StatusBar style="dark" />
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
