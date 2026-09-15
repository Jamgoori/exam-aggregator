import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MEMBERSHIP_FAQ_APP, MEMBERSHIP_FAQ_APP_FORBIDDEN_WORDS } from "./membership-faq";

// 설계서 §8.1: 앱 FAQ 는 결제·환불·요금제·결제 내역·가격을 언급하는 항목을 Phase 5 전까지
// 넣지 않는다(Apple 3.1.1/3.1.3). 문항을 추가할 때 이 테스트가 막아준다.
describe("MEMBERSHIP_FAQ_APP", () => {
  it("결제·환불·요금제·가격을 언급하는 문항이 없다", () => {
    for (const item of MEMBERSHIP_FAQ_APP) {
      for (const word of MEMBERSHIP_FAQ_APP_FORBIDDEN_WORDS) {
        // "원"은 금액 표기("5,900원")만 잡는다 — 일반 단어("원래")까지 막지 않는다.
        const hit = word === "원" ? /\d원/.test(item.q + item.a) : (item.q + item.a).includes(word);
        assert.equal(hit, false, `${item.q} 에 "${word}" 가 들어 있다`);
      }
    }
  });

  it("비어 있지 않다", () => {
    assert.ok(MEMBERSHIP_FAQ_APP.length >= 2);
  });
});
