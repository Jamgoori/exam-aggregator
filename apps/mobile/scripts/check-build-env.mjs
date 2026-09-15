// EAS 빌드 서버에서 install 직전에 도는 검사(package.json 의 eas-build-pre-install).
//
// 왜 필요한가: EXPO_PUBLIC_* 는 JS 번들에 값이 그대로 박히는 변수다. 빌드 서버에
// 값이 없으면 번들은 `undefined` 를 담은 채 **정상적으로 만들어지고**, APK 도 나오고,
// 설치도 된다. 그리고 폰에서 앱을 켜는 순간 src/lib/supabase.ts 가 import 단계에서
// throw 하며 즉시 꺼진다. 빌드는 초록불인데 앱만 죽는, 원인 찾기 제일 나쁜 형태다.
//
// 실제로 한 번 그렇게 나갔다: 워크플로가 러너에 .env 를 썼지만 .env 는 gitignore
// 대상이라 EAS 업로드 아카이브에 들어가지 않았다. 여기서 미리 끊어 빌드를 실패시키면
// 폰에 설치해 보기 전에 로그에서 원인을 본다.
const REQUIRED = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  // 약관·개인정보처리방침 링크와 /api/app/config 최소 버전 게이트가 이 주소를 쓴다.
  // 없으면 두 문서가 죽어 스토어 심사에서 반려된다 — 빌드 단계에서 끊는다.
  "EXPO_PUBLIC_WEB_URL",
];

// 없으면 기능이 빠질 뿐 앱이 죽지는 않는 것들 — 경고만 한다.
const OPTIONAL = [
  "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
  "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID",
  "EXPO_PUBLIC_SENTRY_DSN",
];

const missing = REQUIRED.filter((name) => !process.env[name]);

for (const name of OPTIONAL) {
  if (!process.env[name]) {
    console.warn(`[build-env] 경고: ${name} 없음 — 관련 기능이 동작하지 않는다.`);
  }
}

if (missing.length > 0) {
  console.error(
    [
      "",
      "빌드 중단: 앱 실행에 필수인 환경변수가 빌드 서버에 없다.",
      ...missing.map((name) => `  - ${name}`),
      "",
      "이대로 빌드하면 APK 는 나오지만 앱이 켜지자마자 꺼진다.",
      "eas.json 의 해당 빌드 프로필 env 에 값을 넣거나(GitHub Actions 워크플로가",
      "저장소 시크릿에서 자동 주입한다), EAS 대시보드의 환경변수에 등록할 것.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`[build-env] 필수 환경변수 확인 완료 (${REQUIRED.length}개).`);
