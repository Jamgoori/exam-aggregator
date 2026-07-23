import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from "react-native";
import { signInWithGoogle, signInWithKakao } from "../../src/lib/auth";
import { colors } from "../../src/theme/colors";

// 웹 login/page.tsx 와 동일하게 소셜 전용. 차이는 네이티브 SDK 로 바로 로그인한다는 점.
export default function LoginScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState<"google" | "kakao" | null>(null);

  async function run(provider: "google" | "kakao") {
    try {
      setBusy(provider);
      if (provider === "google") await signInWithGoogle();
      else await signInWithKakao();
      // 로그인 성공 시 onAuthStateChange 가 세션을 갱신한다. 모달을 닫고 원래 화면으로.
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)");
    } catch (e) {
      Alert.alert("로그인 실패", e instanceof Error ? e.message : "다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ flex: 1, padding: 24, gap: 12, justifyContent: "center" }}>
      <Text style={{ fontSize: 22, fontWeight: "600", marginBottom: 4 }}>로그인</Text>
      <Text style={{ color: colors.textMuted, marginBottom: 16 }}>
        처음이라면 로그인과 동시에 가입돼요.
      </Text>

      <Pressable
        onPress={() => run("google")}
        disabled={busy !== null}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          paddingVertical: 12,
          alignItems: "center",
        }}
      >
        {busy === "google" ? (
          <ActivityIndicator />
        ) : (
          <Text style={{ fontWeight: "500" }}>Google로 계속하기</Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => run("kakao")}
        disabled={busy !== null}
        style={{
          backgroundColor: colors.kakao,
          borderRadius: 10,
          paddingVertical: 12,
          alignItems: "center",
        }}
      >
        {busy === "kakao" ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={{ fontWeight: "500", color: "rgba(0,0,0,0.9)" }}>
            카카오로 계속하기
          </Text>
        )}
      </Pressable>
    </View>
  );
}
