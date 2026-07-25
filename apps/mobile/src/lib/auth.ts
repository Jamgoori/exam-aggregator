import type { GoogleSignin as GoogleSigninType } from "@react-native-google-signin/google-signin";
import { env, isGoogleConfigured } from "./env";
import { supabase } from "./supabase";

// ─────────────────────────────────────────────────────────────────────────────
// 네이티브 소셜 로그인 → Supabase 세션 교환
//
// 웹은 signInWithOAuth 로 브라우저를 띄우지만, 앱은 네이티브 SDK가 반환한
// id_token 을 supabase.auth.signInWithIdToken 으로 바로 교환한다. 이러면
// 인앱 브라우저 왕복 없이 카카오톡/구글 계정 앱으로 바로 로그인된다.
//
// ⚠️ 네이티브 모듈은 반드시 "지연 로드"한다.
//   @react-native-google-signin 은 모듈 최상단에서
//   TurboModuleRegistry.getEnforcing('RNGoogleSignin') 을 부른다. 네이티브 모듈이
//   없는 환경(Expo Go, 오토링킹 누락 빌드)에서는 이 import 만으로 예외가 나는데,
//   이 파일은 auth-provider → 루트 레이아웃으로 이어져 있어 앱이 첫 화면도 못 그리고
//   즉시 종료된다. 그래서 top-level import 대신 함수 안에서 require 한다.
//
// ⚠️ 콘솔 설정 선행 필요 (코드만으론 안 됨):
//   - Google: Google Cloud Console 에서 iOS/Android/Web 클라이언트 ID 발급 →
//     webClientId/iosClientId 는 .env(EXPO_PUBLIC_GOOGLE_*), iOS URL scheme 은
//     app.json 플러그인에. Supabase Auth > Providers > Google 에 Web 클라이언트 ID 등록.
//   - Kakao: Kakao Developers 에서 OpenID Connect 활성화(id_token 발급용).
//     Supabase Auth > Providers > Kakao 활성화 + 콘솔 REST 키 등록.
// ─────────────────────────────────────────────────────────────────────────────

type GoogleModule = { GoogleSignin: typeof GoogleSigninType };
type KakaoModule = { login: () => Promise<unknown> };

const NATIVE_MISSING =
  "이 기능은 개발 빌드(development build)에서만 동작해요. Expo Go 에서는 소셜 로그인을 쓸 수 없어요.";

function loadGoogle(): GoogleModule | null {
  try {
    return require("@react-native-google-signin/google-signin") as GoogleModule;
  } catch {
    return null;
  }
}

function loadKakao(): KakaoModule | null {
  try {
    return require("@react-native-seoul/kakao-login") as KakaoModule;
  } catch {
    return null;
  }
}

let googleConfigured = false;

// 구글 SDK 설정. 네이티브 모듈이 없거나 클라이언트 ID 가 비어 있으면 조용히 건너뛴다
// (앱 시작 시 호출되므로 절대 예외를 밖으로 던지지 않는다).
export function configureGoogle(): boolean {
  if (googleConfigured) return true;
  if (!isGoogleConfigured) return false;
  const mod = loadGoogle();
  if (!mod) return false;
  try {
    mod.GoogleSignin.configure({
      // Supabase 에 등록한 것과 동일한 "Web" 클라이언트 ID 여야 한다.
      webClientId: env.googleWebClientId || undefined,
      iosClientId: env.googleIosClientId || undefined,
    });
    googleConfigured = true;
    return true;
  } catch {
    return false;
  }
}

export async function signInWithGoogle() {
  const mod = loadGoogle();
  if (!mod) throw new Error(NATIVE_MISSING);
  if (!isGoogleConfigured) {
    throw new Error(
      "구글 로그인 설정이 없어요(EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID). 카카오로 로그인해 주세요.",
    );
  }
  // 앱 시작 때 설정이 실패했을 수 있어 로그인 직전에 한 번 더 보장한다.
  configureGoogle();

  const { GoogleSignin } = mod;
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
  const mod = loadKakao();
  if (!mod) throw new Error(NATIVE_MISSING);

  const token = await mod.login();
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

export async function signOut() {
  // 네이티브 SDK 세션과 Supabase 세션 둘 다 정리한다. 네이티브가 없거나 실패해도
  // Supabase 세션만 끊으면 로그아웃된 상태다.
  const google = loadGoogle();
  if (google) {
    await Promise.allSettled([google.GoogleSignin.signOut()]);
  }
  await supabase.auth.signOut();
}
