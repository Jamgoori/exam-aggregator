import {
  GoogleSignin,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { login as kakaoLogin } from "@react-native-seoul/kakao-login";
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

export async function signOut() {
  // 네이티브 SDK 세션과 Supabase 세션 둘 다 정리한다.
  await Promise.allSettled([
    GoogleSignin.signOut(),
    // kakao logout 은 선택 — 실패해도 Supabase 세션만 끊으면 로그아웃된 상태다.
  ]);
  await supabase.auth.signOut();
}

export { statusCodes };
