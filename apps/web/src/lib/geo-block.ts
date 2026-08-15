// 해외 IP 차단(한국·일본만 허용) — 판정만 하는 순수 모듈.
//
// 실제 차단은 proxy.ts 가 이 판정을 받아서 한다. 순수 함수로 떼어 둔 이유는 두 가지다:
//  1) 잘못 막으면 사이트 전체가 죽는 장치다. 네트워크·요청 객체 없이 테스트로
//     "무엇이 통과하고 무엇이 막히는지"를 고정해 둬야 한다(geo-block.test.ts).
//  2) proxy 는 모든 요청에 붙는 코드라 판정에 DB·외부 호출이 섞이면 안 된다.
//
// ── 설계에서 절대 양보하지 않은 것 ──────────────────────────────────────────
//
// **검색엔진을 막으면 안 된다.** 이 사이트의 유입은 검색이 전부인데 Googlebot·
// Bingbot 은 미국 IP 에서 온다. 국가만 보고 막으면 색인이 통째로 빠진다(403 이 계속
// 나가면 구글은 그 URL 을 색인에서 내린다). 그래서 크롤러 UA 는 국가와 무관하게
// 통과시킨다. UA 는 위조할 수 있지만, 이 장치의 목적은 "완벽한 접근 통제"가 아니라
// "해외 트래픽·크롤링 비용 줄이기"라 그 교환은 의도한 것이다. UA 를 위조해서라도
// 들어오는 상대를 막아야 한다면 국가 차단이 아니라 다른 수단이 필요하다.
//
// **돈과 로그인이 걸린 경로는 막지 않는다.** 결제창에서 돌아오는 /payments/**,
// 소셜 로그인 콜백 /auth/**, PG 웹훅·크론이 부르는 /api/** 는 국가와 무관하게
// 통과시킨다. 결제 승인 리다이렉트를 막으면 "돈은 빠졌는데 멤버십은 안 켜진" 상태가
// 그대로 남는다 — 차단으로 얻는 것보다 잃는 게 크다.
//
// **모르면 통과시킨다(fail open).** 국가 헤더가 없는 환경(로컬 개발, Vercel 이 아닌
// 호스팅, IP 를 못 알아낸 요청)에서는 차단하지 않는다. 판정 근거가 없을 때 막는
// 쪽으로 기울면 배포처를 옮기는 날 사이트가 조용히 닫힌다.

// 기본 허용 국가. 요청대로 한국 + 일본.
export const DEFAULT_ALLOWED_COUNTRIES = "KR,JP";

// Vercel 이 넣어 주는 접속 국가(ISO 3166-1 alpha-2). Cloudflare 뒤에 있을 때를 대비해
// cf-ipcountry 도 함께 본다. 둘 다 우리 인프라가 붙이는 헤더라 클라이언트가 보낸 값이
// 아니다 — 프록시가 덮어쓴다.
export const COUNTRY_HEADERS = ["x-vercel-ip-country", "cf-ipcountry"] as const;

// 우회용 헤더·쿼리·쿠키 이름. 코딩 에이전트·모니터링·해외 체류 중인 운영자가
// 토큰 하나로 통과할 수 있게 한다(GEO_BLOCK_BYPASS_TOKEN).
export const BYPASS_HEADER = "x-geo-bypass";
export const BYPASS_QUERY = "geo_bypass";
export const BYPASS_COOKIE = "geo_bypass";

// 국가와 무관하게 통과시키는 경로.
//
// - /api/**        : PG 웹훅·Vercel 크론. 호출자가 해외 서버다(크론은 Vercel 인프라).
// - /payments/**   : 결제창 복귀. 돈이 이동 중인 경로는 절대 막지 않는다.
// - /auth/**       : 소셜 로그인 콜백. 중간에서 끊으면 세션이 안 심긴 채 멈춘다.
const INFRA_DIRS = ["/api", "/payments", "/auth"] as const;

// 검색·SNS·PWA 가 읽는 메타 파일. 페이지가 아니라 설비다.
// (robots.txt·sitemap.xml·rss.xml 은 proxy matcher 의 확장자 제외로 애초에 여기
//  오지 않지만, matcher 를 손대는 날을 대비해 판정에도 남겨 둔다.)
const INFRA_FILES = [
  "/robots.txt",
  "/sitemap.xml",
  "/rss.xml",
  "/manifest.webmanifest",
  "/favicon.ico",
] as const;

// Next 의 메타데이터 라우트. 마지막 세그먼트로만 판정한다 —
// /papers/<slug>/opengraph-image 처럼 어느 경로 밑에나 붙고, 빌드마다 -<해시> 가
// 따라붙기도 한다. 앞부분으로 startsWith 를 걸면 /iconic 같은 멀쩡한 주소까지 샌다.
const METADATA_SEGMENT =
  /^(icon|apple-icon|opengraph-image|twitter-image)(-[a-z0-9]+)?(\.[a-z0-9]+)?$/i;

// 통과시킬 크롤러. 검색엔진(색인)과 SNS 링크 미리보기만 넣는다.
//
// SEO 분석 봇(Ahrefs·Semrush·MJ12 등)은 일부러 뺐다 — 검색 유입에 기여하지 않으면서
// 해외에서 사이트 전체를 긁어 가는 쪽이라, 이 차단이 실제로 걸러 주기를 바라는 대상이다.
const CRAWLER_UA =
  /(googlebot|google-inspectiontool|storebot-google|adsbot-google|mediapartners-google|feedfetcher-google|google-site-verification|bingbot|bingpreview|adidxbot|msnbot|yeti|daum|applebot|duckduckbot|yandex(bot|images)|baiduspider|facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|telegrambot|discordbot|whatsapp|kakaotalk-scrap|kakaostory|pinterest(bot|\/)|naver)/i;

export type GeoBlockConfig = {
  enabled: boolean;
  allowedCountries: Set<string>;
  bypassToken: string | null;
};

export type GeoBlockInput = {
  pathname: string;
  // 우리 인프라가 붙인 국가 코드. 없으면 null.
  country: string | null;
  userAgent: string | null;
  // 우회 토큰이 실려 온 세 자리. 하나라도 맞으면 통과.
  bypassHeader?: string | null;
  bypassQuery?: string | null;
  bypassCookie?: string | null;
};

export type GeoAllowReason =
  | "disabled"
  | "bypass"
  | "unknown-country"
  | "allowed-country"
  | "infra-path"
  | "crawler";

export type GeoBlockDecision =
  | {
      action: "allow";
      reason: GeoAllowReason;
      // 쿼리로 우회한 경우에만 true. 다음 요청부터는 쿠키로 통과하게 해서, 링크를
      // 한 번 연 뒤에는 주소에 토큰을 달고 다니지 않아도 되게 한다.
      setBypassCookie: boolean;
    }
  | { action: "block"; country: string };

// 환경변수 → 설정. 프로덕션에서만 켤지 같은 판단은 호출부(proxy)가 한다.
//
// 기본값이 "꺼짐"인 것은 의도적이다. 이 코드가 배포되는 순간 조용히 해외 접속이
// 끊기면, 왜 안 되는지 아무도 모르는 채로 문의만 들어온다. 켜는 것은 환경변수
// GEO_BLOCK=on 을 넣는 한 번의 명시적인 행동이어야 하고, 되돌리는 것도 같은 자리에서
// 값 하나(GEO_BLOCK=off)를 고쳐 재배포하는 것으로 끝나야 한다.
export function readGeoBlockConfig(env: {
  GEO_BLOCK?: string;
  GEO_BLOCK_COUNTRIES?: string;
  GEO_BLOCK_BYPASS_TOKEN?: string;
}): GeoBlockConfig {
  const flag = (env.GEO_BLOCK ?? "").trim().toLowerCase();
  return {
    enabled: flag === "on" || flag === "1" || flag === "true",
    allowedCountries: parseCountries(env.GEO_BLOCK_COUNTRIES),
    bypassToken: env.GEO_BLOCK_BYPASS_TOKEN?.trim() || null,
  };
}

export function parseCountries(raw: string | undefined | null): Set<string> {
  const value = (raw ?? "").trim() || DEFAULT_ALLOWED_COUNTRIES;
  return new Set(
    value
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  );
}

// 토큰 비교. 길이가 다르면 어차피 다르므로 먼저 걸러내고, 같은 길이일 때만 전체를
// 훑어 비교한다(비교 시간으로 토큰을 한 글자씩 알아내는 걸 막는 상수시간 비교).
function tokenMatches(candidate: string | null | undefined, token: string): boolean {
  if (!candidate || candidate.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= candidate.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

export function isInfraPath(pathname: string): boolean {
  if (INFRA_DIRS.some((dir) => pathname === dir || pathname.startsWith(`${dir}/`))) {
    return true;
  }
  if ((INFRA_FILES as readonly string[]).includes(pathname)) return true;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return METADATA_SEGMENT.test(lastSegment);
}

export function isCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return CRAWLER_UA.test(userAgent);
}

// 판정 본체. 순서가 곧 정책이라 위에서부터 읽으면 된다.
export function decideGeoBlock(
  config: GeoBlockConfig,
  input: GeoBlockInput,
): GeoBlockDecision {
  if (!config.enabled) return allow("disabled", false);

  // 우회 토큰. 사람이 손으로 여는 경우(쿼리)와 자동화(헤더)를 모두 받는다.
  if (config.bypassToken) {
    if (
      tokenMatches(input.bypassHeader, config.bypassToken) ||
      tokenMatches(input.bypassCookie, config.bypassToken)
    ) {
      return allow("bypass", false);
    }
    if (tokenMatches(input.bypassQuery, config.bypassToken)) {
      return allow("bypass", true);
    }
  }

  // 돈·로그인·설비 경로는 국가를 보지 않는다.
  if (isInfraPath(input.pathname)) return allow("infra-path", false);

  // 검색엔진·SNS 미리보기는 국가를 보지 않는다. 이게 없으면 색인이 빠진다.
  if (isCrawlerUserAgent(input.userAgent)) return allow("crawler", false);

  const country = (input.country ?? "").trim().toUpperCase();
  // 국가를 모르면 통과(fail open). Vercel 은 알 수 없는 경우 빈 값이나 XX 를 준다.
  if (!country || country === "XX") return allow("unknown-country", false);

  if (config.allowedCountries.has(country)) return allow("allowed-country", false);

  return { action: "block", country };
}

function allow(reason: GeoAllowReason, setBypassCookie: boolean): GeoBlockDecision {
  return { action: "allow", reason, setBypassCookie };
}

// 차단 화면. 외부에서 스타일시트를 못 받아오는 상황(차단된 건 문서만이 아니다)이라
// 인라인 스타일 하나로 끝낸다. 한국어와 영어를 같이 적는 이유는, 이 화면을 보는
// 사람은 정의상 한국어권 밖에 있을 수 있기 때문이다.
export function geoBlockHtml(country: string): string {
  const safeCountry = country.replace(/[^A-Z]/gi, "").slice(0, 2) || "??";
  return `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>해외 접속 제한 · Access restricted</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
         background:#fafafa; color:#18181b; padding:24px; }
  @media (prefers-color-scheme: dark) { body { background:#09090b; color:#fafafa; } }
  main { max-width:34rem; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 12px; }
  p { margin:0 0 10px; font-size:.9rem; line-height:1.7; opacity:.85; }
  code { font-size:.8rem; opacity:.6; }
  a { color:#2563eb; }
</style>
<main>
  <h1>해외에서는 이용할 수 없어요</h1>
  <p>공모아는 국내(한국·일본) 접속만 허용하고 있어요. VPN 을 쓰고 있다면 끄고 다시
     시도해주세요. 국내에서 접속했는데도 이 화면이 보인다면 알려주세요.</p>
  <p>This service is available from Korea and Japan only.
     If you are using a VPN, please turn it off and try again.</p>
  <p><a href="mailto:lks2354@gmail.com">lks2354@gmail.com</a></p>
  <p><code>${safeCountry}</code></p>
</main>
`;
}
