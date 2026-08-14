import test from "node:test";
import assert from "node:assert/strict";
import {
  MEMBERSHIP_PLANS,
  BASE_MONTHLY_PRICE,
  allPlanPricing,
  findPlan,
  formatWon,
  planPricing,
} from "./pricing";

test("플랜 세 종의 금액이 정본과 일치한다", () => {
  assert.deepEqual(
    MEMBERSHIP_PLANS.map((p) => [p.id, p.months, p.price]),
    [
      ["monthly", 1, 5900],
      ["quarterly", 3, 14900],
      ["yearly", 12, 39900],
    ],
  );
  assert.equal(BASE_MONTHLY_PRICE, 5900);
});

test("1개월권은 기준선이라 할인이 0", () => {
  const p = planPricing(MEMBERSHIP_PLANS[0]);
  assert.equal(p.monthlyPrice, 5900);
  assert.equal(p.savedAmount, 0);
  assert.equal(p.discountPercent, 0);
});

test("3개월권: 월 환산은 올림, 할인율은 내림", () => {
  const p = planPricing(MEMBERSHIP_PLANS[1]);
  // 14,900 / 3 = 4,966.67 → 올림 4,967
  assert.equal(p.monthlyPrice, 4967);
  assert.equal(p.baselinePrice, 17700);
  assert.equal(p.savedAmount, 2800);
  // 2,800 / 17,700 = 15.81% → 내림 15
  assert.equal(p.discountPercent, 15);
});

test("1년권: 월 환산 3,325원 · 할인 43%", () => {
  const p = planPricing(MEMBERSHIP_PLANS[2]);
  assert.equal(p.monthlyPrice, 3325);
  assert.equal(p.baselinePrice, 70800);
  assert.equal(p.savedAmount, 30900);
  // 30,900 / 70,800 = 43.64% → 내림 43 (반올림하면 44가 되어 실제보다 커 보인다)
  assert.equal(p.discountPercent, 43);
});

test("할인율은 결코 실제보다 크게 나오지 않는다", () => {
  for (const p of allPlanPricing()) {
    const real = (p.savedAmount / p.baselinePrice) * 100;
    assert.ok(p.discountPercent <= real, `${p.plan.id}: ${p.discountPercent} > ${real}`);
    // 월 환산가 x 개월수는 실제 결제액 이상이어야 한다(싸 보이지 않게).
    assert.ok(p.monthlyPrice * p.plan.months >= p.plan.price);
  }
});

test("기간이 길수록 월 환산가가 싸진다", () => {
  const monthly = allPlanPricing().map((p) => p.monthlyPrice);
  for (let i = 1; i < monthly.length; i++) {
    assert.ok(monthly[i] < monthly[i - 1]);
  }
});

test("findPlan: 모르는 id는 null", () => {
  assert.equal(findPlan("yearly")?.price, 39900);
  assert.equal(findPlan("lifetime"), null);
  assert.equal(findPlan(null), null);
});

test("formatWon: 천 단위 구분", () => {
  assert.equal(formatWon(5900), "5,900원");
  assert.equal(formatWon(39900), "39,900원");
});
