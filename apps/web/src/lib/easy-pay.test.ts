import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEasyPayMethods } from "./easy-pay";

// 간편결제 노출 목록 파싱. 이 값이 잘못 읽히면 계약이 끝난 결제수단이 화면에서 통째로
// 빠지거나(매출 손실), 계약 안 된 수단이 열려 결제창에서 실패한다.

test("비어 있으면 아무 것도 열지 않는다", () => {
  // 기본값 = 지금까지의 동작(카드/간편결제 통합결제창 하나). 설정을 안 한 환경에서
  // 버튼이 멋대로 생기면 계약 전에 결제가 실패한다.
  for (const empty of [undefined, null, "", "   ", ",", " , ,"]) {
    assert.deepEqual(parseEasyPayMethods(empty), []);
  }
});

test("영문 코드를 읽는다", () => {
  assert.deepEqual(parseEasyPayMethods("KAKAOPAY,NAVERPAY"), ["KAKAOPAY", "NAVERPAY"]);
  // 공백과 대소문자는 흔한 실수라 받아준다.
  assert.deepEqual(parseEasyPayMethods(" kakaopay , NaverPay "), ["KAKAOPAY", "NAVERPAY"]);
});

test("한글 이름도 읽는다", () => {
  // 상점관리자 화면에 한글로 적혀 있어서 그대로 옮겨 적는 경우.
  assert.deepEqual(parseEasyPayMethods("카카오페이,네이버페이"), ["KAKAOPAY", "NAVERPAY"]);
  assert.deepEqual(parseEasyPayMethods("토스페이, 페이코"), ["TOSSPAY", "PAYCO"]);
});

test("적은 순서를 그대로 유지한다", () => {
  // 화면에 놓이는 순서라서 뒤집히면 안 된다.
  assert.deepEqual(parseEasyPayMethods("NAVERPAY,KAKAOPAY"), ["NAVERPAY", "KAKAOPAY"]);
});

test("중복은 한 번만 남긴다", () => {
  // 같은 버튼이 두 개 생기면 사용자는 둘이 다른 줄 안다.
  assert.deepEqual(parseEasyPayMethods("카카오페이,KAKAOPAY"), ["KAKAOPAY"]);
});

test("모르는 값은 버리고 나머지는 살린다", () => {
  // 오타 하나 때문에 계약이 끝난 다른 수단까지 사라지면 안 된다.
  assert.deepEqual(parseEasyPayMethods("KAKAO_PAY,NAVERPAY"), ["NAVERPAY"]);
  assert.deepEqual(parseEasyPayMethods("스마일페이"), []);
});
