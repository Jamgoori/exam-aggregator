import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import { SecureStorage } from "./secure-storage";

// 웹(@supabase/ssr)과 달리 모바일은 쿠키가 없다. 세션(access/refresh token)을
// 기기 보안 저장소(iOS Keychain / Android Keystore)에 넣고 백그라운드에서 자동
// 갱신한다. AsyncStorage 는 평문이라 리프레시 토큰 같은 장기 자격증명엔 부적절해서
// SecureStore 어댑터를 쓴다. RLS 가 데이터를 보호하므로 publishable(anon) 키는 앱
// 번들에 넣어도 안전하다.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

// 값이 없을 때 여기서 throw 하면 안 된다. 이 파일은 루트 레이아웃이 import 하는
// 모듈이라, import 단계에서 던지면 화면이 뜨기도 전에 앱이 그냥 종료된다 —
// 사용자에게는 "앱이 계속 중단됨" 만 보이고 이유를 알 방법이 없다(실제로 그렇게
// 한 번 나갔다). 대신 오류를 값으로 내보내고, 루트 레이아웃이 읽을 수 있는 화면으로
// 보여준다.
export const supabaseConfigError =
  !supabaseUrl || !supabaseAnonKey
    ? "EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY 가 빌드에 포함되지 않았습니다."
    : null;

// 설정이 없으면 형식만 맞는 더미로 만든다 — createClient 가 빈 문자열에 던지는 것을
// 막기 위한 것이고, 이 클라이언트로 오는 요청은 어차피 실패한다. 위 오류 화면이
// 먼저 뜨므로 실제로 쓰이지 않는다.
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key",
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
