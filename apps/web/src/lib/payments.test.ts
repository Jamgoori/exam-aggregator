import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSettlement } from "./payments";

// 결제 승인 직전의 판단만 검증한다. 여기가 돈이 걸린 유일한 분기라, 네트워크·DB 없이
// 확인할 수 있게 순수 함수로 떼어 두었다.

const PAID_AMOUNT = 39900;

function row(over: Partial<Parameters<typeof decideSettlement>[0]> = {}) {
  return { status: "ready" as const, amount: PAID_AMOUNT, granted_at: null, ...over };
}

test("금액이 맞으면 승인을 진행한다", () => {
  assert.deepEqual(decideSettlement(row(), PAID_AMOUNT), {
    action: "confirm",
    amount: PAID_AMOUNT,
  });
});

test("승인 금액은 언제나 DB 의 금액이다", () => {
  // 리다이렉트 쿼리의 금액은 사용자가 고칠 수 있는 값이다. 설령 검증을 통과하는
  // 경로가 생기더라도 승인에 나가는 숫자는 우리 것이어야 한다.
  const decision = decideSettlement(row({ amount: 5900 }), 5900);
  assert.equal(decision.action, "confirm");
  assert.equal(decision.action === "confirm" && decision.amount, 5900);
});

test("금액을 깎아서 돌아오면 승인하지 않는다", () => {
  // 39,900원짜리를 100원에 승인시키려는 시도.
  assert.deepEqual(decideSettlement(row(), 100), {
    action: "reject",
    reason: "amount_mismatch",
  });
});

test("금액을 부풀려도 승인하지 않는다", () => {
  assert.deepEqual(decideSettlement(row(), PAID_AMOUNT + 1), {
    action: "reject",
    reason: "amount_mismatch",
  });
});

test("숫자가 아닌 금액은 승인하지 않는다", () => {
  // Number("") 은 0, Number("abc") 는 NaN 이다. NaN !== amount 로도 걸리지만,
  // 비교 이전에 명시적으로 막는지 확인한다.
  for (const bad of [NaN, Infinity, -Infinity]) {
    assert.deepEqual(decideSettlement(row(), bad), {
      action: "reject",
      reason: "amount_mismatch",
    });
  }
});

test("이미 승인된 주문은 다시 승인하지 않는다", () => {
  // 사용자가 결과 화면을 새로고침하거나, 웹훅이 먼저 도착한 경우.
  assert.deepEqual(
    decideSettlement(row({ status: "paid", granted_at: "2026-08-14T11:00:00Z" }), PAID_AMOUNT),
    { action: "already_paid", needsGrant: false },
  );
});

test("승인은 됐는데 기간을 못 준 주문은 부여만 마저 한다", () => {
  // 승인 직후 멤버십 UPDATE 가 실패한 경우. 돈은 받았으므로 재승인이 아니라
  // 부여만 다시 시도해야 한다.
  assert.deepEqual(decideSettlement(row({ status: "paid", granted_at: null }), PAID_AMOUNT), {
    action: "already_paid",
    needsGrant: true,
  });
});

test("취소된 주문은 되살아나지 않는다", () => {
  assert.deepEqual(decideSettlement(row({ status: "canceled" }), PAID_AMOUNT), {
    action: "reject",
    reason: "already_canceled",
  });
});

test("이미 승인된 주문은 금액 검증보다 먼저 걸린다", () => {
  // 이미 돈을 받은 주문에 엉뚱한 금액으로 다시 들어와도 재승인 경로로 새지 않는다.
  assert.deepEqual(decideSettlement(row({ status: "paid" }), 100), {
    action: "already_paid",
    needsGrant: true,
  });
});
