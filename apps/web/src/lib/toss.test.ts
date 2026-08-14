import { test } from "node:test";
import assert from "node:assert/strict";
import { keysMatch } from "./toss";

// 키 쌍 검증. 토스 대시보드는 서로 다른 두 쌍(주문서형 gck/gsk, API 개별 연동 ck/sk)을
// 한 화면에 나란히 보여줘서 한 줄씩 어긋나게 집기 쉽다. 어긋나면 결제창은 정상으로 뜨고
// 승인 단계에서만 실패한다 — 사용자가 카드 정보를 다 넣은 다음에야 깨진다.
//
// 아래 키 문자열은 형식만 맞춘 가짜 값이다(실제 키를 저장소에 남기지 않는다).

test("같은 쌍이면 통과한다", () => {
  assert.equal(keysMatch("test_gck_AAAA", "test_gsk_BBBB"), true);
  assert.equal(keysMatch("test_ck_AAAA", "test_sk_BBBB"), true);
  assert.equal(keysMatch("live_gck_AAAA", "live_gsk_BBBB"), true);
  assert.equal(keysMatch("live_ck_AAAA", "live_sk_BBBB"), true);
});

test("종류가 어긋나면 막는다 (주문서형 ↔ API 개별 연동)", () => {
  // 대시보드에서 위쪽 클라이언트 키 + 아래쪽 시크릿 키를 집은 경우.
  assert.equal(keysMatch("test_gck_AAAA", "test_sk_BBBB"), false);
  assert.equal(keysMatch("test_ck_AAAA", "test_gsk_BBBB"), false);
});

test("모드가 어긋나면 막는다 (test ↔ live)", () => {
  // 가장 위험한 경우: 라이브 클라이언트 키로 사용자는 실제 카드로 결제하는데
  // 우리는 테스트 환경에 승인을 요청한다.
  assert.equal(keysMatch("live_gck_AAAA", "test_gsk_BBBB"), false);
  assert.equal(keysMatch("test_gck_AAAA", "live_gsk_BBBB"), false);
  assert.equal(keysMatch("live_ck_AAAA", "test_sk_BBBB"), false);
});

test("클라이언트 자리에 시크릿 키를 넣으면 막는다", () => {
  // 복사 실수로 시크릿 키가 NEXT_PUBLIC_ 쪽에 들어가는 것은 단순 오설정이 아니라
  // 시크릿 유출이다. 쌍 검사에서 걸려 결제가 열리지 않는다.
  assert.equal(keysMatch("test_gsk_AAAA", "test_gsk_BBBB"), false);
  assert.equal(keysMatch("test_sk_AAAA", "test_sk_BBBB"), false);
});

test("형식이 아닌 값은 막는다", () => {
  for (const bad of ["", "  ", "sk_test_stripe_style", "test_xx_AAAA", "TEST_GCK_AAAA"]) {
    assert.equal(keysMatch(bad, "test_gsk_BBBB"), false, `client=${bad}`);
    assert.equal(keysMatch("test_gck_AAAA", bad), false, `secret=${bad}`);
  }
});
