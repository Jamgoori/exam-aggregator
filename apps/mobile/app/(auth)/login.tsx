import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  View,
} from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  isAppleCancel,
  isAppleSignInAvailable,
  signInWithApple,
  signInWithGoogle,
  signInWithKakao,
} from "../../src/lib/auth";
import { openLegal, type LegalDoc } from "../../src/lib/legal";
import { colors } from "../../src/theme/colors";

type Provider = "google" | "kakao" | "apple";

// 웹 login/page.tsx 와 동일하게 소셜 전용. 차이는 네이티브 SDK 로 바로 로그인한다는 점과,
// iOS 심사 요건상 Apple 로그인이 추가된다는 점(Android 에선 숨긴다).
export default function LoginScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState<Provider | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    let alive = true;
    isAppleSignInAvailable()
      .then((ok) => alive && setAppleAvailable(ok))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function run(provider: Provider) {
    try {
      setBusy(provider);
      if (provider === "google") await signInWithGoogle();
      else if (provider === "kakao") await signInWithKakao();
      else await signInWithApple();
      // 로그인 성공 시 onAuthStateChange 가 세션을 갱신한다. 모달을 닫고 원래 화면으로.
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)");
    } catch (e) {
      // Apple 시트를 사용자가 닫은 건 실패가 아니다 — 조용히 원래 화면에 머무른다.
      if (isAppleCancel(e)) return;
      Alert.alert("로그인 실패", e instanceof Error ? e.message : "다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  async function openDoc(doc: LegalDoc) {
    try {
      await openLegal(doc);
    } catch (e) {
      Alert.alert("문서를 열 수 없어요", e instanceof Error ? e.message : "");
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

      {/* Apple 은 버튼 모양·문구가 HIG 로 정해져 있어 직접 그리지 않고 제공 컴포넌트를 쓴다.
          (자체 버튼으로 만들면 심사에서 반려된다.) */}
      {appleAvailable &&
        (busy === "apple" ? (
          <View
            style={{
              height: 46,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#000",
            }}
          >
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={10}
            style={{ height: 46 }}
            onPress={() => {
              if (busy === null) run("apple");
            }}
          />
        ))}

      {/* 웹 로그인 페이지와 같은 고지. 앱은 스토어 심사에서 약관·처리방침 접근 경로를 본다. */}
      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8, lineHeight: 18 }}>
        로그인하면{" "}
        <Text style={{ color: colors.primary }} onPress={() => openDoc("terms")}>
          이용약관
        </Text>
        과{" "}
        <Text style={{ color: colors.primary }} onPress={() => openDoc("privacy")}>
          개인정보처리방침
        </Text>
        에 동의한 것으로 간주돼요.
      </Text>
    </View>
  );
}
