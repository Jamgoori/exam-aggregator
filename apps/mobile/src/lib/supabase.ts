import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// 웹(@supabase/ssr)과 달리 모바일은 쿠키가 없다. 세션(access/refresh token)을
// AsyncStorage에 직접 저장하고, 백그라운드에서 자동 갱신한다. RLS가 데이터를
// 보호하므로 publishable(anon) 키는 앱 번들에 넣어도 안전하다.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY 가 .env 에 없습니다.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // 모바일은 URL 콜백(#access_token=...)으로 세션을 받지 않는다. 네이티브 SDK가
    // 준 id_token을 signInWithIdToken 으로 교환하는 방식이라 URL 감지는 끈다.
    detectSessionInUrl: false,
  },
});
