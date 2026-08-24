import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideDownloadCount,
  isBrowserUserAgent,
  isNonHumanUserAgent,
  readDownloadHeaders,
  type DownloadRequestHeaders,
} from "./download-counting";

// 이 판정이 느슨하면 "누적 다운로드"는 다시 봇 숫자가 되고, 빡빡하면 진짜 사용자가
// 조용히 사라진다. **무엇이 세어지고 무엇이 빠지는가**를 여기에 못박아 둔다.
//
// 특히 국내 인앱 브라우저(네이버·카카오톡·다음)는 UA 에 회사 이름이 그대로 박혀 있어서
// 봇 목록에 이름을 넣는 순간 통째로 빠진다. 아래 케이스가 그걸 막는 장치다.

function decide(over: Partial<DownloadRequestHeaders> = {}) {
  return decideDownloadCount({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    secPurpose: null,
    purpose: null,
    xPurpose: null,
    xMoz: null,
    secFetchDest: "document",
    ...over,
  });
}

// ── 사람: 반드시 세어져야 한다 ──────────────────────────────────────────────

const HUMAN_UA: Record<string, string> = {
  "데스크톱 크롬":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "아이폰 사파리":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  파이어폭스:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  엣지: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  삼성인터넷:
    "Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  웨일: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Whale/3.26.244.21 Safari/537.36",
  // 아래 셋이 이 파일의 핵심이다. 이름만 보고 봇 목록에 넣으면 국내 모바일 유입이 날아간다.
  "네이버 앱 인앱브라우저":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.4.5)",
  "카카오톡 인앱브라우저":
    "Mozilla/5.0 (Linux; Android 13; SM-S918N Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.163 Mobile Safari/537.36 KAKAOTALK 10.3.5",
  "다음 앱 인앱브라우저":
    "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Mobile Safari/537.36 DaumApps/6.5.1",
  // 관공서 PC 에 아직 남아 있다. 버리지 않는다.
  IE11: "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko",
};

for (const [name, ua] of Object.entries(HUMAN_UA)) {
  test(`${name} 은 센다`, () => {
    assert.deepEqual(decide({ userAgent: ua }), { count: true, reason: "counted" });
  });
}

test("Sec-Fetch 헤더가 아예 없는 옛 브라우저도 센다", () => {
  assert.equal(decide({ secFetchDest: null }).count, true);
});

// ── 봇: 절대 세면 안 된다 ───────────────────────────────────────────────────

const BOT_UA: Record<string, string> = {
  Googlebot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/140.0.0.0 Safari/537.36",
  Bingbot:
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  "네이버 Yeti": "Mozilla/5.0 (compatible; Yeti/1.1; +http://naver.me/spd)",
  "다음 Daumoa": "Mozilla/5.0 (compatible; Daumoa/4.0; +http://cs.daum.net/faq/15/4118.html)",
  "카카오 링크미리보기":
    "Mozilla/5.0 (compatible; kakaotalk-scrap/1.0; +https://devtalk.kakao.com)",
  AhrefsBot: "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
  Bytespider:
    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
  GPTBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  ClaudeBot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  Barkrowler: "Mozilla/5.0 (compatible; Barkrowler/0.9; +https://babbar.tech/crawler)",
  페이스북미리보기: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  curl: "curl/8.4.0",
  wget: "Wget/1.21.4",
  "python-requests": "python-requests/2.31.0",
  "Go 클라이언트": "Go-http-client/2.0",
  okhttp: "okhttp/4.12.0",
  "안드로이드 Dalvik": "Dalvik/2.1.0 (Linux; U; Android 13; SM-S918N Build/TP1A.220624.014)",
  헤드리스크롬:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36",
  Lighthouse:
    "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Chrome-Lighthouse",
};

for (const [name, ua] of Object.entries(BOT_UA)) {
  test(`${name} 은 세지 않는다`, () => {
    assert.equal(decide({ userAgent: ua }).count, false);
  });
}

test("UA 가 없으면 세지 않는다 — 모르면 안 센다가 기본값이다", () => {
  assert.deepEqual(decide({ userAgent: null }), {
    count: false,
    reason: "no-user-agent",
  });
  assert.equal(decide({ userAgent: "   " }).reason, "no-user-agent");
});

// ── 사람의 브라우저지만 사람이 누르지 않은 요청 ─────────────────────────────

test("브라우저 프리페치는 세지 않는다", () => {
  assert.equal(decide({ secPurpose: "prefetch" }).reason, "prefetch");
  assert.equal(decide({ secPurpose: "prefetch;prerender" }).reason, "prefetch");
  assert.equal(decide({ purpose: "prefetch" }).reason, "prefetch");
  assert.equal(decide({ xPurpose: "preview" }).reason, "prefetch");
  assert.equal(decide({ xMoz: "prefetch" }).reason, "prefetch");
});

test("문서 이동이 아닌 요청(fetch·XHR·이미지)은 세지 않는다", () => {
  for (const dest of ["empty", "image", "script", "iframe"]) {
    assert.equal(decide({ secFetchDest: dest }).reason, "not-a-navigation");
  }
});

// ── 조각 함수 ───────────────────────────────────────────────────────────────

test("isBrowserUserAgent 는 엔진 표식이 없는 UA 를 거른다", () => {
  assert.equal(isBrowserUserAgent("Mozilla/5.0 (compatible; Yeti/1.1)"), false);
  assert.equal(isBrowserUserAgent(null), false);
  assert.equal(isBrowserUserAgent(HUMAN_UA["아이폰 사파리"]), true);
});

test("isNonHumanUserAgent 는 UA 가 없으면 사람이 아니라고 본다", () => {
  assert.equal(isNonHumanUserAgent(null), true);
  assert.equal(isNonHumanUserAgent(HUMAN_UA["네이버 앱 인앱브라우저"]), false);
});

test("readDownloadHeaders 는 판정에 쓰는 헤더만 뽑는다", () => {
  const headers = new Headers({
    "user-agent": "Mozilla/5.0 AppleWebKit/537.36",
    "sec-purpose": "prefetch",
    "sec-fetch-dest": "document",
    // 쿠키는 판정에 쓰지 않는다 — 여기 넣어 두고 결과에 안 섞이는지 본다.
    cookie: "sb-access-token=abc123",
  });
  assert.deepEqual(readDownloadHeaders(headers), {
    userAgent: "Mozilla/5.0 AppleWebKit/537.36",
    secPurpose: "prefetch",
    purpose: null,
    xPurpose: null,
    xMoz: null,
    secFetchDest: "document",
  });
});
