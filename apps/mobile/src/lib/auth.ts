import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { initializeKakaoSDK } from "@react-native-kakao/core";
import { login as kakaoLogin } from "@react-native-kakao/user";
import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { Platform } from "react-native";
import { callEdge } from "./edge";
import { clearAllCaches } from "./query-client";
import { cancelDailyReminder } from "./reminders";
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
//     webClientId 는 아래 configureAuth 에, iOS clientId 는 app.json 플러그인에.
//     Supabase 대시보드 Auth > Providers > Google 에 Web 클라이언트 ID 등록.
//   - Kakao: Kakao Developers 에서 OpenID Connect 활성화(id_token 발급용).
//     Supabase 대시보드 Auth > Providers > Kakao 활성화 + 콘솔 REST 키 등록.
//     네이티브 id_token 의 aud 는 네이티브 앱 키라 Supabase Kakao client-ID 목록에도
//     추가해야 한다(설계서 §7.1 "Kakao aud" — 스테이징 스파이크 대상).
//   - Apple: 소유자 결정(§12-2 6번)으로 보류. 함수는 두되 로그인 화면에서 쓰지 않는다.
// ─────────────────────────────────────────────────────────────────────────────

// Kakao 네이티브 앱 키는 app.json 의 @react-native-kakao/core 플러그인 한 곳에만 둔다.
// 런타임 SDK 초기화도 같은 값을 써야 하므로 expo-constants 로 그 항목을 읽는다.
function kakaoNativeAppKey(): string | null {
  const plugins = (Constants.expoConfig?.plugins ?? []) as unknown[];
  for (const p of plugins) {
    if (Array.isArray(p) && p[0] === "@react-native-kakao/core") {
      const key = (p[1] as { nativeAppKey?: string } | undefined)?.nativeAppKey;
      if (typeof key === "string" && key) return key;
    }
  }
  return null;
}

let configured = false;
export function configureAuth() {
  if (configured) return;
  configured = true;
  GoogleSignin.configure({
    // Supabase 에 등록한 것과 동일한 "Web" 클라이언트 ID 여야 한다.
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });
  const kakaoKey = kakaoNativeAppKey();
  if (kakaoKey) {
    initializeKakaoSDK(kakaoKey).catch(() => {
      // 초기화 실패는 로그인 시점에 다시 드러난다.
    });
  }
}

// 로그인 직후 순서(§7.1, 웹 /auth/callback 파리티): signInWithIdToken → membership-get
// (체험 시작은 EF 안에서만) → 닉네임 온보딩 → next. 멤버십 조회 실패는 로그인 실패가 아니다.
async function afterSignIn() {
  await callEdge("membership-get", {}).catch(() => {});
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
  await afterSignIn();
  return data;
}

// 사용자가 카카오 로그인 창을 직접 닫은 경우.
export function isKakaoCancel(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = (e as { message?: string })?.message ?? "";
  return code === "E_CANCELLED_OPERATION" || /cancel/i.test(message);
}

export async function signInWithKakao() {
  // id_token replay 방어: nonce 를 Kakao 에 넘기면 id_token 의 nonce 클레임에 **그대로**
  // 박힌다(Apple 과 달리 해시하지 않음). GoTrue 는 전달한 nonce 를 원문 → sha256 순으로
  // 클레임과 비교하므로 원문을 그대로 넘기면 된다.
  const nonce = Crypto.randomUUID();
  const token = await kakaoLogin({ nonce });
  const idToken = token.idToken;
  if (!idToken) {
    throw new Error("Kakao idToken 이 없습니다. Kakao Developers 에서 OpenID Connect 를 활성화하세요.");
  }
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "kakao",
    token: idToken,
    nonce,
  });
  if (error) throw error;
  await afterSignIn();
  return data;
}

// ── Apple(보류) ──────────────────────────────────────────────────────────────
// iOS 빌드(1b)·Apple 결정 뒤에 로그인 화면에 붙인다. 함수는 유지.

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
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

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

  // Apple 은 이름을 최초 1회만 준다. 닉네임은 어차피 온보딩(/onboarding/nickname)에서 직접
  // 받으므로 credential.fullName 은 쓰지 않는다.
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple",
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;
  await afterSignIn();
  return data;
}

// 로그아웃(§7.1): signOut(local) → 캐시 초기화 → 로컬 리마인더 취소 → Google SDK signOut.
//
// 순서가 중요하다: **세션을 먼저 끊고** 그 다음에 캐시를 지운다. 반대로 하면 캐시를
// 지우는 동안에도 세션이 살아 있어서, 그 사이에 화면이 다시 조회하면 방금 지운 자리에
// 개인 데이터가 그대로 다시 쓰인다(공용 기기에서 다음 사람이 오프라인으로 열면 보인다).
export async function signOut() {
  await supabase.auth.signOut({ scope: "local" });
  await clearAllCaches();
  await Promise.allSettled([cancelDailyReminder(), GoogleSignin.signOut()]);
}

export { statusCodes };
