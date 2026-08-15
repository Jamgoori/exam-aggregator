import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOrigin } from "./request-origin";

// 여기서 만든 주소는 결제 successUrl 과 로그인 redirectTo 가 된다. 요청 헤더에 실려 온
// 호스트를 그대로 쓰면 우리 서버가 남의 도메인을 가리키는 링크를 만들어 주게 된다.

const SITE = "https://gongmoa.kr";

function origin(over: Partial<Parameters<typeof resolveOrigin>[0]> = {}) {
  return resolveOrigin({
    forwardedHost: null,
    host: null,
    forwardedProto: null,
    siteUrl: SITE,
    ...over,
  });
}

test("우리 도메인은 그대로 쓴다", () => {
  assert.equal(origin({ forwardedHost: "gongmoa.kr", forwardedProto: "https" }), SITE);
  assert.equal(
    origin({ forwardedHost: "www.gongmoa.kr", forwardedProto: "https" }),
    "https://www.gongmoa.kr",
  );
});

test("프리뷰 배포와 로컬은 그대로 쓴다 — 여기서 결제하면 여기로 돌아와야 한다", () => {
  assert.equal(
    origin({ forwardedHost: "gongmoa-abc123.vercel.app", forwardedProto: "https" }),
    "https://gongmoa-abc123.vercel.app",
  );
  assert.equal(origin({ host: "localhost:3000" }), "http://localhost:3000");
  assert.equal(origin({ host: "127.0.0.1:3001" }), "http://127.0.0.1:3001");
});

test("모르는 호스트를 넣어 보내면 정본 주소로 되돌린다", () => {
  // 결제 승인 키가 남의 서버로 실려 가는 경로를 여기서 끊는다.
  assert.equal(origin({ forwardedHost: "evil.com", forwardedProto: "https" }), SITE);
  assert.equal(origin({ host: "evil.com" }), SITE);
  // 우리 도메인처럼 보이려는 변형들.
  assert.equal(origin({ forwardedHost: "gongmoa.kr.evil.com" }), SITE);
  assert.equal(origin({ forwardedHost: "evil.com/gongmoa.kr" }), SITE);
  assert.equal(origin({ forwardedHost: "notgongmoa.kr" }), SITE);
  assert.equal(origin({ forwardedHost: "evil.vercel.app.attacker.com" }), SITE);
});

test("헤더가 아예 없으면 정본 주소", () => {
  assert.equal(origin(), SITE);
  assert.equal(origin({ forwardedHost: "  " }), SITE);
});

test("사슬로 이어진 헤더는 맨 앞(원 발신자)만 본다", () => {
  assert.equal(
    origin({ forwardedHost: "gongmoa.kr, evil.com", forwardedProto: "https, http" }),
    SITE,
  );
  assert.equal(origin({ forwardedHost: "evil.com, gongmoa.kr" }), SITE);
});

test("http/https 가 아닌 스킴은 받지 않는다", () => {
  assert.equal(
    origin({ forwardedHost: "gongmoa.kr", forwardedProto: "javascript" }),
    SITE,
  );
});

test("대소문자가 섞여 와도 같은 판정", () => {
  assert.equal(origin({ forwardedHost: "GongMoa.KR", forwardedProto: "https" }), SITE);
});
