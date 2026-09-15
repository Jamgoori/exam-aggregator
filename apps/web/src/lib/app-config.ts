// 모바일 앱의 강제 업데이트·최신 버전 안내에 쓰는 설정(/api/app/config)의 순수 파싱.
//
// 값은 Vercel 환경변수에서 읽는다 — 앱 최소 빌드 번호를 올리는 일이 코드 배포 없이
// 환경변수 하나 바꾸고 재배포하는 것으로 끝나야 하기 때문이다. 라우트는 얇게 두고
// 여기서 숫자·빈 값 처리를 해 테스트로 고정한다(app-config.test.ts).
//
// 숫자는 "정수가 아니면 0" 이다. 0 은 "제한 없음"(어떤 빌드도 minBuild 미만이 아니다)
// 이라 잘못 적은 값이 전 사용자를 업데이트 화면에 가두는 쪽으로 기울지 않는다.

export type AppConfig = {
  minBuild: { ios: number; android: number };
  latestBuild: { ios: number; android: number };
  message: string | null;
  storeUrl: { ios: string | null; android: string | null };
};

export type AppConfigEnv = {
  APP_MIN_BUILD_IOS?: string;
  APP_MIN_BUILD_ANDROID?: string;
  APP_LATEST_BUILD_IOS?: string;
  APP_LATEST_BUILD_ANDROID?: string;
  APP_UPDATE_MESSAGE?: string;
  APP_STORE_URL_IOS?: string;
  APP_STORE_URL_ANDROID?: string;
};

// 빌드 번호는 음이 아닌 정수. 그 밖(빈 값·소수·음수·문자)은 전부 0.
export function parseBuildNumber(raw: string | undefined | null): number {
  const value = (raw ?? "").trim();
  if (!/^\d+$/.test(value)) return 0;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : 0;
}

function parseOptionalString(raw: string | undefined | null): string | null {
  const value = (raw ?? "").trim();
  return value || null;
}

export function readAppConfig(env: AppConfigEnv): AppConfig {
  return {
    minBuild: {
      ios: parseBuildNumber(env.APP_MIN_BUILD_IOS),
      android: parseBuildNumber(env.APP_MIN_BUILD_ANDROID),
    },
    latestBuild: {
      ios: parseBuildNumber(env.APP_LATEST_BUILD_IOS),
      android: parseBuildNumber(env.APP_LATEST_BUILD_ANDROID),
    },
    message: parseOptionalString(env.APP_UPDATE_MESSAGE),
    storeUrl: {
      ios: parseOptionalString(env.APP_STORE_URL_IOS),
      android: parseOptionalString(env.APP_STORE_URL_ANDROID),
    },
  };
}
