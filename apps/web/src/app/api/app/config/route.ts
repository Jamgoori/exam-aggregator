import { readAppConfig } from "@/lib/app-config";

// 모바일 앱이 시작·포그라운드마다 읽는 버전 설정(apps/mobile/docs/redesign-architecture.md §6.6).
// 앱은 expo-application 의 nativeBuildVersion 을 minBuild 와 비교해 미만이면 강제
// 업데이트 화면을, latestBuild 초과분은 배너를 띄운다.
//
// /api/version 과 다르다 — 그쪽은 배포 커밋 SHA 를 돌려주는 워밍 엔드포인트라
// no-store 다. 여기는 값이 환경변수라 배포마다만 바뀌므로 5분 캐시로 CDN 에 얹는다
// (앱 사용자 전부가 실행마다 두드리는 주소다). /api/** 라 해외 IP 차단 면제.
//
// 값은 Vercel 환경변수(APP_MIN_BUILD_IOS 등, .env.local.example 참고)에서 읽고,
// 파싱은 lib/app-config.ts 가 한다. 바꾼 뒤에는 재배포해야 반영된다.
export async function GET() {
  const env = process.env;
  return Response.json(
    readAppConfig({
      APP_MIN_BUILD_IOS: env.APP_MIN_BUILD_IOS,
      APP_MIN_BUILD_ANDROID: env.APP_MIN_BUILD_ANDROID,
      APP_LATEST_BUILD_IOS: env.APP_LATEST_BUILD_IOS,
      APP_LATEST_BUILD_ANDROID: env.APP_LATEST_BUILD_ANDROID,
      APP_UPDATE_MESSAGE: env.APP_UPDATE_MESSAGE,
      APP_STORE_URL_IOS: env.APP_STORE_URL_IOS,
      APP_STORE_URL_ANDROID: env.APP_STORE_URL_ANDROID,
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300, s-maxage=300",
      },
    },
  );
}
