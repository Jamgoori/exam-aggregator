// 홈의 "누적 다운로드"에 **사람이 누른 것만** 들어가게 하는 판정. 요청 객체 없이
// 테스트로 고정할 수 있게 순수 함수로 떼어 뒀다(download-counting.test.ts).
//
// ── 왜 필요했나 ─────────────────────────────────────────────────────────────
// /download/[id] 는 로그인을 보지 않고, 카운터 RPC 도 anon 에 열려 있다
// (schema.sql: `grant execute on function increment_download_count(uuid) to anon`).
// robots.txt 로 /download 를 막아 뒀지만 robots 는 강제력이 없고 지키는 봇만 지킨다 —
// 실제로 "사용자가 없는 6일 동안 함수 호출 103만 건"이 찍힌 적이 있다(robots.ts 주석).
// 그래서 누적 다운로드는 회원 활동과 무관하게 혼자 올라가는 숫자가 돼 있었다.
// (최종 로그인은 첫 로그인에서 멈춰 있는데 다운로드만 늘던 현상의 정체가 이것이다.)
//
// ── 판정 방향: 화이트리스트 ─────────────────────────────────────────────────
// **봇 목록으로 거르지 않는다.** 봇 UA 는 매주 새로 생기고 위조도 자유라 블랙리스트는
// 언제나 뒤늦다. 대신 "브라우저처럼 보이는 요청"만 센다 — 집계에서는 "모르면 안 센다"가
// 옳은 기본값이다. 적게 세면 과소집계로 끝나지만, 많이 세면 숫자 자체가 못 쓰게 된다.
// 자기를 브라우저라고 사칭하는 봇(Googlebot 의 최신 UA 가 그렇다)을 위해 블랙리스트도
// 함께 두지만, 그건 어디까지나 보조다.
//
// ── 이건 접근 통제가 아니다 ─────────────────────────────────────────────────
// 여기서 false 가 나와도 파일은 그대로 내준다. 집계에서만 빠진다. 봇의 트래픽·비용을
// 실제로 막으려면 Vercel Firewall 쪽이어야 한다(robots.ts 주석과 같은 판단).

// 브라우저 엔진 표식. 실제 브라우저는 예외 없이 이 중 하나를 달고 온다.
//  - applewebkit : Chrome·Safari·Edge·삼성인터넷·웨일, 그리고 iOS 인앱 브라우저 전부
//  - gecko/      : Firefox 계열 (Chrome UA 의 "(KHTML, like Gecko)" 와 구분하려고 슬래시까지 본다)
//  - trident/    : 옛 IE. 아직 남아 있는 관공서 환경을 버리지 않는다.
const BROWSER_ENGINE = /(applewebkit|gecko\/|trident\/)/i;

// 브라우저를 사칭하는 쪽을 걸러 내는 보조 목록.
//
// **여기에 naver·daum·kakaotalk 를 절대 넣지 말 것.** 셋 다 크롤러 이름이 아니라
// 인앱 브라우저의 UA 표식이다 — 네이버 앱은 `NAVER(inapp; search; ...)`, 카카오톡은
// `KAKAOTALK 10.x`, 다음 앱은 `DaumApps/...` 로 온다. 국내 모바일 유입의 상당수가
// 이 인앱 브라우저인데, 이름만 보고 넣으면 진짜 사람이 통째로 집계에서 사라진다.
// 각 사의 실제 크롤러는 이름이 따로 있다(네이버 Yeti, 다음 Daumoa, 카카오 kakaotalk-scrap).
//
// 같은 이유로 geo-block.ts 의 CRAWLER_UA 를 재사용하지 않는다. 그쪽은 "국가 차단에서
// 통과시킬 검색엔진" 목록이라 naver·daum 같은 넓은 조각이 들어 있고, 목적도 정반대다
// (그쪽은 넓을수록 안전하고, 여기서는 넓으면 사람을 지운다).
const NON_HUMAN_UA = new RegExp(
  [
    // 자기 신고형 크롤러. 대부분 이 세 조각에 걸린다.
    String.raw`bot\b`,
    String.raw`bot/`,
    "crawler",
    "spider",
    "scrap", // kakaotalk-scrap 포함
    "slurp",
    "archiver",
    "fetcher",
    "barkrowler", // "crawler" 가 아니라 "rowler" 라 위 조각에 안 걸린다
    // 검색엔진·SNS 의 봇 중 이름에 bot 이 없는 것들.
    "yeti", // 네이버 크롤러
    "daumoa", // 다음 크롤러
    "bingpreview",
    "googleother",
    "apis-google",
    "mediapartners",
    "inspectiontool",
    "facebookexternalhit",
    "facebot",
    "externalagent", // meta-externalagent
    "whatsapp",
    "telegram",
    "discord",
    "embedly",
    "anthropic-ai",
    "cohere-ai",
    "webzio",
    // HTTP 클라이언트·스크립트. 사람이 브라우저로 누른 것이 아니다.
    "curl",
    "wget",
    "python",
    "libwww",
    "httpclient",
    "httpx",
    "aiohttp",
    "axios",
    "node-fetch",
    "undici",
    "okhttp",
    "dalvik",
    String.raw`java/`,
    "go-http",
    "postman",
    "insomnia",
    // 자동화 브라우저·측정 도구. UA 는 Chrome 이지만 사람이 아니다.
    "headless",
    "phantomjs",
    "puppeteer",
    "playwright",
    "selenium",
    "lighthouse",
    "pagespeed",
    "gtmetrix",
    "pingdom",
    "uptime",
    "vercel",
  ].join("|"),
  "i",
);

// 브라우저가 "사용자가 아직 안 눌렀지만 미리 받아 두는" 요청에 붙이는 표식.
// 링크를 눈으로만 스쳐도 요청이 나가므로, 이게 붙은 요청을 세면 클릭 없이 카운트가 오른다.
// (Chrome 은 Sec-Purpose, 옛 Chrome 은 Purpose, Safari 는 X-Purpose, Firefox 는 X-Moz.)
const PREFETCH_HEADERS = [
  ["secPurpose", /prefetch|prerender/i],
  ["purpose", /prefetch|preview/i],
  ["xPurpose", /prefetch|preview/i],
  ["xMoz", /prefetch|preload/i],
] as const;

export type DownloadRequestHeaders = {
  userAgent: string | null;
  secPurpose: string | null;
  purpose: string | null;
  xPurpose: string | null;
  xMoz: string | null;
  secFetchDest: string | null;
};

export type DownloadCountReason =
  | "counted"
  | "no-user-agent"
  | "not-a-browser"
  | "known-bot"
  | "prefetch"
  | "not-a-navigation";

export type DownloadCountDecision = {
  // true 일 때만 increment_download_count 를 부른다. 파일은 어느 쪽이든 내준다.
  count: boolean;
  reason: DownloadCountReason;
};

// Request → 판정 입력. 헤더 이름을 한 곳에만 적어 두려고 뺐다.
export function readDownloadHeaders(headers: Headers): DownloadRequestHeaders {
  return {
    userAgent: headers.get("user-agent"),
    secPurpose: headers.get("sec-purpose"),
    purpose: headers.get("purpose"),
    xPurpose: headers.get("x-purpose"),
    xMoz: headers.get("x-moz"),
    secFetchDest: headers.get("sec-fetch-dest"),
  };
}

export function isBrowserUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return /mozilla\//i.test(userAgent) && BROWSER_ENGINE.test(userAgent);
}

export function isNonHumanUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return NON_HUMAN_UA.test(userAgent);
}

// 판정 본체. 순서가 곧 정책이라 위에서부터 읽으면 된다.
export function decideDownloadCount(
  input: DownloadRequestHeaders,
): DownloadCountDecision {
  const ua = input.userAgent?.trim();
  if (!ua) return { count: false, reason: "no-user-agent" };

  // 미리 받아 두는 요청. 브라우저가 보낸 것은 맞지만 사람은 아직 아무것도 안 눌렀다.
  for (const [key, pattern] of PREFETCH_HEADERS) {
    const value = input[key];
    if (value && pattern.test(value)) return { count: false, reason: "prefetch" };
  }

  // 주소창으로 문서를 여는 요청만 센다. 화면의 두 버튼은 모두 <a href target="_blank">
  // 이므로 dest 는 document 로 온다. 헤더 자체가 없는 옛 브라우저는 그냥 통과시킨다
  // (없다고 막으면 오래된 사파리 사용자가 통째로 빠진다).
  if (input.secFetchDest && input.secFetchDest !== "document") {
    return { count: false, reason: "not-a-navigation" };
  }

  if (!isBrowserUserAgent(ua)) return { count: false, reason: "not-a-browser" };
  if (isNonHumanUserAgent(ua)) return { count: false, reason: "known-bot" };

  return { count: true, reason: "counted" };
}
