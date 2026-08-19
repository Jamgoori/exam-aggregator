import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { login as kakaoLogin } from "@react-native-seoul/kakao-login";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { clearCache } from "./offline";
import { supabase } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// 네이티브 소셜 로그인 → Supabase 세션 교환
//
// 웹은 signInWithOAuth 로 브라우저를 띄우지만, 앱은 네이티브 SDK가 반환한
// id_token 을 supabase.auth.signInWithIdToken 으로 바로 교환한다. 이러면
// 인앱 브라우저 왕복 없이 카카오톡/구글 계정 앱으로 바로 로그인된다.
//
// ⚠️ 콘솔 설정 선행 필요 (코드만으론 안 됨):
//   - Google: Google Cloud Console 에서 iOS/Android/Web 클라이언트 ID 발급 →
//     webClientId 는 아래 configureGoogle 에, iOS clientId 는 app.json 플러그인에.
//     Supabase 대시보드 Auth > Providers > Google 에 Web 클라이언트 ID 등록.
//   - Kakao: Kakao Developers 에서 OpenID Connect 활성화(id_token 발급용).
//     Supabase 대시보드 Auth > Providers > Kakao 활성화 + 콘솔 REST 키 등록.
//     activate OIDC 안 하면 idToken 이 안 나와서 signInWithIdToken 실패한다.
//   - Apple: Apple Developer 에서 Sign in with Apple 을 App ID 에 켜고, Services ID·
//     Key(.p8) 로 Supabase 대시보드 Auth > Providers > Apple 을 설정.
//     iOS 심사 요건이라 다른 소셜 로그인이 있으면 필수다(Android 에선 숨긴다).
// ─────────────────────────────────────────────────────────────────────────────

export function configureGoogle() {
  GoogleSignin.configure({
    // Supabase 에 등록한 것과 동일한 "Web" 클라이언트 ID 여야 한다.
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });
}

export async function signInWithGoogle() {
  await GoogleSignin.hasPlayServices();
  const userInfo = await GoogleSignin.signIn();
  const idToken = userInfo.data?.idToken;
  if (!idToken) {
    throw new Error("Google 로그인에서 idToken 을 받지 못했습니다.");
  }
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
  });
  if (error) throw error;
  return data;
}

export async function signInWithKakao() {
  const token = await kakaoLogin();
  // OIDC 활성화 시 KakaoLoginToken 에 idToken 이 포함된다.
  const idToken = (token as { idToken?: string }).idToken;
  if (!idToken) {
    throw new Error(
      "Kakao idToken 이 없습니다. Kakao Developers 에서 OpenID Connect 를 활성화하세요.",
    );
  }
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "kakao",
    token: idToken,
  });
  if (error) throw error;
  return data;
}

// Apple 로그인 버튼을 그릴지 여부. iOS 13 미만·Android 에선 false 라 버튼을 숨긴다.
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  return AppleAuthentication.isAvailableAsync();
}

// 사용자가 Apple 시트를 직접 닫은 경우. 로그인 실패 알림을 띄우면 안 된다.
export function isAppleCancel(e: unknown): boolean {
  return (e as { code?: string })?.code === "ERR_REQUEST_CANCELED";
}

export async function signInWithApple() {
  // id_token replay 방어(SECURITY.md 5번): 원본 nonce 의 SHA-256 을 Apple 에 넘겨
  // id_token 의 nonce 클레임에 박아두고, Supabase 에는 원본을 넘긴다. GoTrue 가
  // sha256(원본)(hex) 과 클레임을 비교하므로 탈취한 토큰을 재사용할 수 없다.
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) {
    throw new Error("Apple 로그인에서 identityToken 을 받지 못했습니다.");
  }

  // Apple 은 이름을 최초 1회만 준다. 닉네임은 어차피 온보딩(/nickname)에서 직접 받으므로
  // credential.fullName 은 쓰지 않는다.
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  // 순서가 중요하다: **세션을 먼저 끊고** 그 다음에 캐시를 지운다.
  //
  // 반대로 하면(예전 순서) 캐시를 지우는 동안에도 세션이 살아 있어서, 그 사이에 화면이
  // 다시 조회하면 방금 지운 자리에 개인 데이터가 그대로 다시 쓰인다. 실제로 설정 화면의
  // 로그아웃이 signOut 을 기다리지 않고 마이페이지로 넘어가는 바람에, 마이페이지가 아직
  // 유효한 세션으로 오답노트를 다시 받아 캐시에 남겼다 — 공용 기기에서 다음 사람이
  // 오프라인으로 열면 그 화면이 그대로 보였다.
  await supabase.auth.signOut();
  // 네이티브 SDK 세션도 정리한다.
  await Promise.allSettled([
    GoogleSignin.signOut(),
    // kakao logout 은 선택 — 실패해도 Supabase 세션만 끊으면 로그아웃된 상태다.
  ]);
  // 오프라인 캐시에 남은 개인 데이터(오답노트 등)를 기기에서 지운다.
  await clearCache();
}

export { statusCodes };
