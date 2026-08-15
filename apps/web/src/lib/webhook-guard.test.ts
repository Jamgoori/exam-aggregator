import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRateLimiter,
  isAllowedIp,
  isValidPaymentKey,
  parseIpAllowlist,
  requestIp,
} from "./webhook-guard";

// ── paymentKey 형식 ─────────────────────────────────────────────────────────

test("정상 paymentKey 는 통과한다", () => {
  assert.equal(isValidPaymentKey("5EnNZRJGvaBX7zk2yd8ydw26XvwXkLrx9POLqKQjmAw4b0e1"), true);
  assert.equal(isValidPaymentKey("test_key-123_ABC"), true);
});

test("형식이 아닌 값은 토스에 묻지도 않는다", () => {
  for (const bad of [
    "", // 빈 값
    "../../v1/payments/other", // 경로 조작 시도
    "key with space",
    "키/슬래시",
    "a".repeat(201), // 길이 초과
    null,
    123,
    { paymentKey: "x" },
  ]) {
    assert.equal(isValidPaymentKey(bad), false, JSON.stringify(bad));
  }
});

// ── 발신 IP 허용 목록 ───────────────────────────────────────────────────────

test("목록이 비어 있으면 IP 로 거르지 않는다 (기본값)", () => {
  const empty = parseIpAllowlist("");
  assert.equal(isAllowedIp("1.2.3.4", empty), true);
  assert.equal(isAllowedIp(null, empty), true);
  assert.equal(isAllowedIp("1.2.3.4", parseIpAllowlist(undefined)), true);
});

test("목록이 있으면 그 안의 IP 만 통과한다", () => {
  const list = parseIpAllowlist(" 13.124.1.1, 52.78.2.2 ");
  assert.equal(isAllowedIp("13.124.1.1", list), true);
  assert.equal(isAllowedIp("52.78.2.2", list), true);
  assert.equal(isAllowedIp("9.9.9.9", list), false);
  // IP 를 못 알아낸 요청도 목록이 켜져 있으면 통과시키지 않는다.
  assert.equal(isAllowedIp(null, list), false);
});

// ── 유량 제한 ───────────────────────────────────────────────────────────────

test("한도까지는 통과하고 그 뒤로 막는다", () => {
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
  const t0 = 1_000_000;
  assert.equal(limiter.take("ip", t0), true);
  assert.equal(limiter.take("ip", t0), true);
  assert.equal(limiter.take("ip", t0), true);
  assert.equal(limiter.take("ip", t0), false);
});

test("창이 지나면 다시 센다", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  const t0 = 1_000_000;
  assert.equal(limiter.take("ip", t0), true);
  assert.equal(limiter.take("ip", t0 + 999), false);
  assert.equal(limiter.take("ip", t0 + 1000), true);
});

test("IP 마다 따로 센다 — 한 곳이 퍼부어도 다른 곳은 막히지 않는다", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
  const t0 = 1_000_000;
  assert.equal(limiter.take("attacker", t0), true);
  assert.equal(limiter.take("attacker", t0), false);
  // 진짜 토스 웹훅은 여기 걸리면 안 된다.
  assert.equal(limiter.take("toss", t0), true);
});

test("키가 무한히 쌓이지 않는다", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 10 });
  // 서로 다른 IP 를 상한보다 훨씬 많이 밀어 넣어도 터지지 않고 계속 판정한다.
  for (let i = 0; i < 100; i++) {
    assert.equal(limiter.take(`ip-${i}`, 1_000_000 + i), true);
  }
});

// ── 발신 IP 추출 ────────────────────────────────────────────────────────────

test("x-real-ip 를 먼저 쓰고, 없으면 x-forwarded-for 의 첫 항목", () => {
  const headers = (map: Record<string, string>) => ({
    get: (name: string) => map[name] ?? null,
  });
  assert.equal(requestIp(headers({ "x-real-ip": "1.1.1.1" })), "1.1.1.1");
  assert.equal(
    requestIp(headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9" })),
    "1.1.1.1",
  );
  assert.equal(
    requestIp(headers({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })),
    "2.2.2.2",
  );
  assert.equal(requestIp(headers({})), null);
});
