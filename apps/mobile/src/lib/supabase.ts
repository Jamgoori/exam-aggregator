import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "./env";
import { SecureStorage } from "./secure-storage";

// 웹(@supabase/ssr)과 달리 모바일은 쿠키가 없다. 세션(access/refresh token)을
// 기기 보안 저장소(iOS Keychain / Android Keystore)에 넣고 백그라운드에서 자동
// 갱신한다. AsyncStorage 는 평문이라 리프레시 토큰 같은 장기 자격증명엔 부적절해서
// SecureStore 어댑터를 쓴다. RLS 가 데이터를 보호하므로 publishable(anon) 키는 앱
// 번들에 넣어도 안전하다.
//
// ⚠️ 이 모듈은 루트 레이아웃이 import 한다. 여기서 throw 하면 첫 화면을 그리기도
// 전에 번들 평가가 실패해 앱이 즉시 종료된다(= 실행하자마자 꺼짐). 그래서 환경변수가
// 없어도 더미 값으로 클라이언트를 만들어 두고, app/_layout.tsx 가
// isSupabaseConfigured 를 보고 설정 안내 화면을 대신 띄운다.
const PLACEHOLDER_URL = "https://placeholder.supabase.co";
const PLACEHOLDER_KEY = "placeholder-anon-key";

export const supabase = createClient(
  isSupabaseConfigured ? env.supabaseUrl : PLACEHOLDER_URL,
  isSupabaseConfigured ? env.supabaseAnonKey : PLACEHOLDER_KEY,
  {
    auth: {
      storage: SecureStorage,
      autoRefreshToken: true,
      persistSession: true,
      // 모바일은 URL 콜백(#access_token=...)으로 세션을 받지 않는다. 네이티브 SDK가
      // 준 id_token을 signInWithIdToken 으로 교환하는 방식이라 URL 감지는 끈다.
      detectSessionInUrl: false,
    },
  },
);
