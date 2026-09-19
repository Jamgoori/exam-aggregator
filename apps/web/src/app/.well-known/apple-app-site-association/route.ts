// /.well-known/apple-app-site-association — iOS 가 "gongmoa.kr 링크를 어느 앱이 열 수
// 있는가"를 확인할 때 읽는 파일(설계서 §5 딥링크 문단). 이 파일이 있어야
// https://gongmoa.kr/papers/... 를 누른 사람이 사파리 대신 앱으로 들어온다.
//
// public/ 의 정적 파일이 아니라 라우트 핸들러인 이유: Team ID 를 저장소에 커밋하지
// 않으려는 것이다. 값은 Vercel 환경변수(APP_APPLE_TEAM_ID)에서 읽는다. 지문·Team ID
// 자체는 비밀이 아니지만, 소유자가 아직 못 받은 값을 자리표시자로 박아 두면 그게
// 그대로 배포된다 — 값은 언제나 env 로 받는다(/ads.txt 의 게시자 ID 와 반대 방향의
// 선택이다: 저쪽은 "비면 광고가 조용히 멈추는" 값이라 코드가 정본이고, 이쪽은
// "틀리면 링크가 조용히 안 열리는" 값이라 없을 때 파일 자체가 없어야 한다).
//
// **값이 없을 때 빈 JSON 을 내주지 말 것.** iOS 는 이 파일을 애플 CDN
// (app-site-association.cdn-apple.com)을 통해 읽고, 기기는 앱 설치 시점에 받은 판정을
// 오래 들고 있는다. 자리표시자 appID 가 든 파일을 한 번 내주면 "이 도메인은 그 앱 것이
// 아니다"가 캐시돼, 나중에 진짜 Team ID 를 넣어도 한동안 링크가 안 열린다(재설치 전까지).
// 파일이 아예 없으면(404) 검증은 다음 설치·다음 수집에서 다시 시도된다 — 그래서 404 다.
//
// 리다이렉트 금지: 애플 검증기는 3xx 를 따라가지 않는다. 확장자가 없어야 하고
// content-type 은 application/json 이어야 한다(text/html 이면 검증 실패).
// next.config.ts 의 www→apex 301 은 host 매칭이라 apex 요청에는 걸리지 않는다.
// 로그인도 필요 없다 — proxy.ts 는 세션 쿠키가 없으면 그냥 통과시키고, 해외 IP
// 차단은 lib/geo-block.ts 의 INFRA_DIRS 에 `/.well-known` 이 있어 면제다(애플 CDN 은
// 언제나 해외 IP 라 이게 빠지면 403 이 나가고 검증이 통째로 실패한다).

// apps/mobile/app.json 의 ios.bundleIdentifier. 앱 ID 는 `<Team ID>.<번들 ID>` 형식이다.
const BUNDLE_ID = "com.gongmoa.app";

// 앱이 여는 경로. **apps/mobile/src/lib/next-path.ts 의 ALLOWED 와 같은 기준이다** —
// 그쪽은 로그인 복귀(`?next=`)·알림 링크를 거르는 매처이고 여기는 OS 가 보는 목록인데,
// 둘이 갈라지면 "앱은 열렸는데 +not-found" 또는 "앱이 있는데 브라우저로 샌다"가 된다.
// 그래서 **아직 앱에 없는 화면(건의 — Phase 5 2라운드)은 여기에도 넣지 않는다.**
// 화면이 생기는 단계에 세 곳(이 파일 · next-path.ts · app.json 의 android.intentFilters)을
// 같이 연다(게시판·공지는 Phase 5 1라운드에서 그렇게 열었다).
//
// 주의: AASA 의 `*` 는 `/` 를 넘어서도 매칭된다(정규식의 `[^/]+` 가 아니다). 그래서
// `/papers/*` 는 `/papers/a/b/c` 까지 잡는데, 그런 주소는 웹에도 없어서 어차피 404 다 —
// 앱이 `+not-found` 를 그리는 것이 브라우저가 404 를 그리는 것보다 나쁘지 않다.
const ALLOWED_PATHS = [
  "/",
  "/papers",
  "/papers/*", // 상세·cbt·explanations·pdf
  "/exams",
  "/exams/*",
  "/subjects",
  "/subjects/*", // 과목 상세·과목 섞어풀기
  "/mix",
  "/diagnosis",
  "/mypage",
  "/mypage/*", // edit·payments·diagnosis·attempts·wrong-notes
  "/membership",
  "/notifications",
  "/board",
  "/board/*", // 상세·new·[id]/edit
  "/notices",
  "/notices/*", // 상세 — new·[id]/edit 는 위 EXCLUDED 가 앞에 서 있어 먼저 걸린다
] as const;

// 위 목록이 이미 화이트리스트라 이것들은 원래 매칭되지 않는다. 그래도 앞에 세워 두는
// 이유는 순서가 곧 정책이기 때문이다 — 나중에 누가 `/*` 같은 넓은 줄을 아래에 더해도
// 관리자·결제·다운로드 주소는 이 줄들에서 먼저 걸린다(설계서 §5 제외 목록).
const EXCLUDED = [
  { path: "/admin/*", comment: "관리자 전용 — 앱에 화면이 없다" },
  { path: "/api/*", comment: "서버 API — 앱은 Edge Function 을 부른다" },
  { path: "/auth/*", comment: "OAuth 콜백 — 브라우저가 끝까지 처리해야 한다" },
  { path: "/payments/*", comment: "토스 결제창 리다이렉트 — 앱이 가로채면 승인이 끊긴다" },
  { path: "/download/*", comment: "웹 전용 다운로드 라우트 — 앱은 Storage 공개 URL 을 쓴다" },
  { path: "/sitemaps/*", comment: "검색엔진용 사이트맵" },
  { path: "/notices/new", comment: "관리자 전용 작성 화면" },
  { path: "/notices/*/edit", comment: "관리자 전용 수정 화면" },
  { path: "/attendance-promo.png", comment: "이미지(앱은 번들 사본을 쓴다)" },
] as const;

// Team ID 는 영숫자 10자(Apple Developer > Membership details). 오타나 따옴표·설명이
// 섞인 값으로 파일을 내주면 그것도 "틀린 appID" 라서 캐시되는 실패가 된다 — 형식이
// 어긋나면 값이 없는 것과 똑같이 취급한다.
function readTeamId(): string | null {
  const raw = process.env.APP_APPLE_TEAM_ID?.trim().toUpperCase();
  if (!raw) return null;
  return /^[A-Z0-9]{10}$/.test(raw) ? raw : null;
}

// Cache Components 에서 GET 라우트는 동적 데이터를 읽지 않으면 알아서 프리렌더된다
// (/ads.txt 와 같은 규칙). 환경변수를 바꾸면 재배포해야 반영된다 — /api/app/config 와 같다.
export function GET() {
  const teamId = readTeamId();
  if (!teamId) return new Response("Not Found", { status: 404 });

  const appId = `${teamId}.${BUNDLE_ID}`;

  const body = {
    applinks: {
      // `appIDs`+`components`(iOS 13+)가 정본이고, `appID`+`paths` 는 그 아래 버전이 읽는
      // 옛 형식이다. 앱 최소 지원이 iOS 16.4 라 옛 형식은 실제로는 아무도 읽지 않지만,
      // 설계서 §5 가 `paths` 로 적어 둔 목록이고 애플이 권하는 하위호환 형태라 같이 낸다.
      // **두 벌을 손으로 적지 않고 같은 배열에서 만든다** — 한쪽만 고치는 사고를 막는 것.
      details: [
        {
          appIDs: [appId],
          components: [
            ...EXCLUDED.map((rule) => ({
              "/": rule.path,
              exclude: true,
              comment: rule.comment,
            })),
            ...ALLOWED_PATHS.map((path) => ({ "/": path })),
          ],
          appID: appId,
          paths: [
            ...EXCLUDED.map((rule) => `NOT ${rule.path}`),
            ...ALLOWED_PATHS,
          ],
        },
      ],
    },
  };

  return new Response(JSON.stringify(body), {
    headers: {
      // 확장자 없는 주소 + application/json 이 애플의 요구사항이다. charset 을 붙이지
      // 않은 것도 의도 — 문서가 요구하는 값 그대로 내준다.
      "content-type": "application/json",
      // OS 만 읽는 설비 파일이라 CDN 이 한동안 들고 있어도 된다(/ads.txt 와 같은 정책).
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
