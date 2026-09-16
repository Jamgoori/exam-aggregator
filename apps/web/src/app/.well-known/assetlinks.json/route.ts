// /.well-known/assetlinks.json — 안드로이드가 "gongmoa.kr 링크를 어느 앱이 열 수 있는가"를
// 확인할 때 읽는 파일(Digital Asset Links, 설계서 §5 딥링크 문단). 앱 설치·업데이트 때
// Play 서비스가 이 파일을 받아 `autoVerify` 인텐트 필터를 검증한다.
//
// iOS 의 AASA 와 역할이 짝이지만 구조가 다르다: **여기에는 경로 목록이 없다.** 안드로이드는
// 도메인 단위로 "이 앱이 이 도메인을 대표한다"만 승인하고, 어느 경로를 앱이 열지는
// apps/mobile/app.json 의 `android.intentFilters` 의 pathPrefix 가 정한다. 그래서 경로를
// 좁히는 일은 저쪽에서 하고, 그 목록은 AASA·apps/mobile/src/lib/next-path.ts 와 같이 자란다.
//
// 지문은 Vercel 환경변수(APP_ANDROID_CERT_FINGERPRINTS)에서 읽고 없으면 404 다. 지문 자체는
// 비밀이 아니지만(APK 에서 누구나 뽑을 수 있다) 소유자가 아직 못 받은 값을 자리표시자로
// 커밋해 두면 그대로 배포되고, **틀린 파일은 조용히 캐시된다** — 검증에 실패하면 안드로이드는
// 링크를 "확인되지 않음"으로 두고 앱을 열지 않으며, 재검증은 다음 설치·업데이트 때나 일어난다.
// 빈 배열을 내주는 것은 "이 도메인은 어떤 앱 것도 아니다"라는 명시적 선언이라 더 나쁘다.
//
// 값이 쉼표로 여러 개인 이유: Play 앱 서명을 쓰면 **업로드 키와 Play 가 다시 서명한 앱
// 서명 키의 지문이 다르다.** 둘 다 넣어야 내부 테스트용 APK(업로드 키 서명)와 Play 배포본이
// 모두 검증을 통과한다.
//
// 리다이렉트 금지(검증기는 3xx 를 따라가지 않는다), 로그인 불필요, 해외 IP 차단 면제
// (lib/geo-block.ts 의 INFRA_DIRS 에 `/.well-known`).

// apps/mobile/app.json 의 android.package. 여기와 저기가 어긋나면 검증이 실패한다.
const PACKAGE_NAME = "com.gongmoa.app";

// SHA-256 지문은 32바이트 = 16진수 64자다. Play Console 은 `AB:CD:…` 로 보여주고
// `eas credentials`·keytool 은 도구에 따라 콜론 없이 뱉기도 해서, 어느 형태로 붙여넣어도
// 받아 콜론 형식으로 정규화한다. 길이가 안 맞으면(오타·SHA-1 을 잘못 넣음) 버린다 —
// 형식이 어긋난 값을 실어 보내면 그것도 "틀린 파일"이라 캐시되는 실패가 된다.
function normalizeFingerprint(raw: string): string | null {
  const hex = raw.trim().toUpperCase().replace(/[^0-9A-F]/g, "");
  if (hex.length !== 64) return null;
  return (hex.match(/../g) ?? []).join(":");
}

function readFingerprints(): string[] {
  return (process.env.APP_ANDROID_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map(normalizeFingerprint)
    .filter((value): value is string => value !== null);
}

// Cache Components 에서 GET 라우트는 동적 데이터를 읽지 않으면 알아서 프리렌더된다
// (/ads.txt 와 같은 규칙). 환경변수를 바꾸면 재배포해야 반영된다.
export function GET() {
  const fingerprints = readFingerprints();
  if (fingerprints.length === 0) {
    return new Response("Not Found", { status: 404 });
  }

  const body = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: PACKAGE_NAME,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      // OS·구글 검증기만 읽는 설비 파일이라 CDN 이 한동안 들고 있어도 된다.
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
