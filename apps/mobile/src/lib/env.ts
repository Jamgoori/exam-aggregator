// 앱 실행에 필요한 공개 환경변수(EXPO_PUBLIC_*)를 한 곳에서 읽는다.
//
// ⚠️ process.env.EXPO_PUBLIC_* 는 번들 시점에 문자열로 인라인된다. 즉 빌드할 때
// 값이 없었으면 앱 안에서는 영원히 undefined 다(런타임 주입 불가). 예전에는
// supabase.ts 가 모듈 최상단에서 throw 했는데, 그 모듈은 루트 레이아웃이
// import 하므로 값이 없으면 JS 번들 평가 단계에서 죽어 "앱이 실행되자마자 꺼지는"
// 증상이 됐다. 그래서 여기서는 던지지 않고 "무엇이 비었는지"만 알려주고,
// 화면(app/_layout.tsx)이 안내를 그리도록 한다.
//
// 동적 접근(process.env[name])은 인라인이 안 되므로 반드시 정적으로 쓴다.

export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "",
  googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "",
};

// Supabase 값이 없으면 데이터가 하나도 안 나오므로 앱을 못 쓴다(치명적).
export const missingSupabaseEnv: string[] = [
  ...(env.supabaseUrl ? [] : ["EXPO_PUBLIC_SUPABASE_URL"]),
  ...(env.supabaseAnonKey ? [] : ["EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]),
];

export const isSupabaseConfigured = missingSupabaseEnv.length === 0;

// 구글 로그인 값은 없어도 앱은 돈다(카카오 로그인·비로그인 열람은 그대로).
export const isGoogleConfigured = Boolean(
  env.googleWebClientId || env.googleIosClientId,
);
