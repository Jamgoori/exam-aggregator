import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideGeoBlock,
  isCrawlerUserAgent,
  isInfraPath,
  parseCountries,
  readGeoBlockConfig,
  type GeoBlockConfig,
} from "./geo-block";

// 이 장치는 잘못 막으면 사이트가 통째로 죽고, 잘못 열면 아무것도 안 한 것이 된다.
// "무엇이 통과하고 무엇이 막히는가"를 여기에 못박아 둔다.

const CONFIG: GeoBlockConfig = {
  enabled: true,
  allowedCountries: parseCountries("KR,JP"),
  bypassToken: "s3cret-token",
};

function decide(over: Partial<Parameters<typeof decideGeoBlock>[1]> = {}, config = CONFIG) {
  return decideGeoBlock(config, {
    pathname: "/",
    country: "US",
    userAgent: "Mozilla/5.0 (Macintosh) Chrome/140",
    ...over,
  });
}

// ── 기본 동작 ───────────────────────────────────────────────────────────────

test("한국·일본은 통과한다", () => {
  assert.equal(decide({ country: "KR" }).action, "allow");
  assert.equal(decide({ country: "JP" }).action, "allow");
  // 헤더가 소문자로 와도 같은 판정이어야 한다.
  assert.equal(decide({ country: "jp" }).action, "allow");
});

test("그 밖의 국가는 막는다", () => {
  for (const country of ["US", "CN", "DE", "VN", "SG"]) {
    assert.deepEqual(decide({ country }), { action: "block", country });
  }
});

test("꺼져 있으면 아무것도 막지 않는다", () => {
  const off = { ...CONFIG, enabled: false };
  assert.equal(decide({ country: "US" }, off).action, "allow");
});

test("국가를 모르면 통과시킨다 (로컬 개발·다른 호스팅으로 옮긴 경우)", () => {
  // 판정 근거가 없을 때 막는 쪽으로 기울면 배포처를 옮기는 날 사이트가 조용히 닫힌다.
  assert.equal(decide({ country: null }).action, "allow");
  assert.equal(decide({ country: "" }).action, "allow");
  assert.equal(decide({ country: "XX" }).action, "allow");
});

// ── SEO: 검색엔진은 국가와 무관하게 통과해야 한다 ───────────────────────────

test("검색엔진 크롤러는 미국 IP 라도 통과한다", () => {
  const bots = [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; Yeti/1.1; +http://naver.me/spd)",
    "Mozilla/5.0 (compatible; Daum/4.1; +http://cs.daum.net/faq/15/4118.html)",
    "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/W.X.Y.Z Safari/537.36 Google-InspectionTool/1.0",
    "Mozilla/5.0 (compatible; DuckDuckBot/1.1; +http://duckduckgo.com/duckduckbot.html)",
    "Applebot/0.1",
  ];
  for (const ua of bots) {
    assert.equal(decide({ country: "US", userAgent: ua }).action, "allow", ua);
  }
});

test("SNS 링크 미리보기 봇도 통과한다 (공유 카드가 깨지면 유입이 끊긴다)", () => {
  for (const ua of [
    "facebookexternalhit/1.1",
    "Twitterbot/1.0",
    "Slackbot-LinkExpanding 1.0",
    "kakaotalk-scrap/1.0",
  ]) {
    assert.equal(decide({ country: "US", userAgent: ua }).action, "allow", ua);
  }
});

test("SEO 수집 봇(Ahrefs·Semrush)은 막는다 — 유입에 기여하지 않는 크롤링이다", () => {
  for (const ua of [
    "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
    "Mozilla/5.0 (compatible; SemrushBot/7~bl; +http://www.semrush.com/bot.html)",
    "Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)",
  ]) {
    assert.equal(decide({ country: "US", userAgent: ua }).action, "block", ua);
  }
});

test("크롤러 판정은 UA 가 없으면 false", () => {
  assert.equal(isCrawlerUserAgent(null), false);
  assert.equal(isCrawlerUserAgent(""), false);
});

// ── 돈·로그인·설비 경로 ─────────────────────────────────────────────────────

test("결제·로그인·API 경로는 국가를 보지 않는다", () => {
  const paths = [
    "/api/payments/toss/webhook", // 토스 웹훅
    "/api/cron/warm", // Vercel 크론(해외 리전에서 올 수 있다)
    "/payments/toss/success", // 승인 리다이렉트 — 막으면 돈만 빠진다
    "/payments/toss/fail",
    "/auth/callback", // 소셜 로그인 콜백
  ];
  for (const pathname of paths) {
    assert.equal(decide({ country: "US", pathname }).action, "allow", pathname);
  }
});

test("앱 심사·딥링크 검증이 부르는 공개 경로는 국가를 보지 않는다", () => {
  // App Review(미국)·Play 심사자가 약관·개인정보처리방침·계정 삭제 안내를 직접 연다.
  // Apple/Google 검증 CDN 이 /.well-known/* 을 읽는다. 403 이면 심사 반려·딥링크 불능.
  const paths = [
    "/terms",
    "/privacy",
    "/account/delete-request",
    "/app-ads.txt",
    "/.well-known/apple-app-site-association",
    "/.well-known/assetlinks.json",
  ];
  for (const pathname of paths) {
    assert.equal(decide({ country: "US", pathname }).action, "allow", pathname);
  }
  // 앞부분만 같은 주소는 면제가 아니다.
  assert.equal(isInfraPath("/terms-of-use"), false);
  assert.equal(isInfraPath("/privacy/edit"), false);
  assert.equal(isInfraPath("/account"), false);
  assert.equal(isInfraPath("/account/delete-request/other"), false);
  assert.equal(isInfraPath("/.well-known-ish"), false);
});

test("메타데이터 라우트는 통과, 비슷하게 생긴 일반 주소는 안 통과", () => {
  assert.equal(isInfraPath("/opengraph-image"), true);
  assert.equal(isInfraPath("/papers/2026-국가직-9급-국어/opengraph-image"), true);
  assert.equal(isInfraPath("/subjects/korean/opengraph-image-a1b2c3.png"), true);
  assert.equal(isInfraPath("/robots.txt"), true);
  assert.equal(isInfraPath("/ads.txt"), true);
  // 앞부분만 같은 멀쩡한 주소까지 새면 안 된다.
  assert.equal(isInfraPath("/apidocs"), false);
  assert.equal(isInfraPath("/papers/icons-of-history"), false);
  assert.equal(isInfraPath("/authors"), false);
});

test("일반 페이지는 해외에서 막힌다", () => {
  for (const pathname of ["/", "/subjects/korean", "/papers/2026-국가직", "/membership"]) {
    assert.equal(decide({ country: "US", pathname }).action, "block", pathname);
  }
});

// ── 우회 토큰 (코딩 에이전트·모니터링·해외 체류 운영자) ──────────────────────

test("헤더 토큰이 맞으면 통과한다", () => {
  const d = decide({ country: "US", bypassHeader: "s3cret-token" });
  assert.equal(d.action, "allow");
  assert.equal(d.action === "allow" && d.setBypassCookie, false);
});

test("쿼리로 우회하면 다음 요청부터는 쿠키로 통과하게 한다", () => {
  const d = decide({ country: "US", bypassQuery: "s3cret-token" });
  assert.equal(d.action, "allow");
  assert.equal(d.action === "allow" && d.setBypassCookie, true);
});

test("쿠키 토큰도 통과한다", () => {
  assert.equal(decide({ country: "US", bypassCookie: "s3cret-token" }).action, "allow");
});

test("틀린 토큰은 통과하지 못한다", () => {
  assert.equal(decide({ country: "US", bypassHeader: "wrong" }).action, "block");
  assert.equal(decide({ country: "US", bypassHeader: "s3cret-toke" }).action, "block");
  assert.equal(decide({ country: "US", bypassHeader: "s3cret-tokeN" }).action, "block");
});

test("토큰을 설정하지 않았으면 아무 값으로도 우회할 수 없다", () => {
  const noToken = { ...CONFIG, bypassToken: null };
  assert.equal(
    decide({ country: "US", bypassHeader: "anything" }, noToken).action,
    "block",
  );
  // 빈 문자열을 보내서 "빈 토큰끼리 일치"로 뚫는 경로도 없어야 한다.
  assert.equal(decide({ country: "US", bypassHeader: "" }, noToken).action, "block");
});

// ── 설정 읽기 ───────────────────────────────────────────────────────────────

test("GEO_BLOCK 은 명시적으로 켜야만 켜진다", () => {
  assert.equal(readGeoBlockConfig({}).enabled, false);
  assert.equal(readGeoBlockConfig({ GEO_BLOCK: "" }).enabled, false);
  assert.equal(readGeoBlockConfig({ GEO_BLOCK: "off" }).enabled, false);
  assert.equal(readGeoBlockConfig({ GEO_BLOCK: "no" }).enabled, false);
  assert.equal(readGeoBlockConfig({ GEO_BLOCK: "on" }).enabled, true);
  assert.equal(readGeoBlockConfig({ GEO_BLOCK: " ON " }).enabled, true);
  assert.equal(readGeoBlockConfig({ GEO_BLOCK: "1" }).enabled, true);
});

test("허용 국가는 기본이 한국·일본이고 환경변수로 바꿀 수 있다", () => {
  assert.deepEqual([...readGeoBlockConfig({}).allowedCountries].sort(), ["JP", "KR"]);
  assert.deepEqual(
    [...readGeoBlockConfig({ GEO_BLOCK_COUNTRIES: "kr, jp ,us" }).allowedCountries].sort(),
    ["JP", "KR", "US"],
  );
  // 빈 값은 "아무 나라도 허용하지 않음"이 아니라 기본값이어야 한다 —
  // 오타 하나로 전 세계가 막히면 안 된다.
  assert.deepEqual([...parseCountries("   ")].sort(), ["JP", "KR"]);
});
