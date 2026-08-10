import { test } from "node:test";
import assert from "node:assert/strict";
import { conceptKeyOf, sameConcept } from "./concept-key";

// 이 규칙이 하는 일은 "큐가 같은 개념으로 도배되지 않게" 하나뿐이다. 정밀 개념
// 분류가 아니므로, 테스트도 "묶여야 할 것이 묶이는가"와 "안전한가"만 본다.

test("표기가 흔들려도 같은 개념으로 묶는다", () => {
  // 실제로 갈리는 방식이 이렇다 — keyword_title 은 통제 어휘가 아니다.
  const keys = [
    "대칭키 암호",
    "대칭키 암호화 방식",
    "대칭키 암호 개념",
    "대칭키 알고리즘",
  ].map(conceptKeyOf);

  assert.equal(new Set(keys).size, 1, `키가 갈렸다: ${keys.join(" / ")}`);
});

test("조사가 붙은 앞토막도 같은 키가 된다", () => {
  assert.equal(conceptKeyOf("행정행위의 하자"), conceptKeyOf("행정행위 취소"));
});

test("서로 다른 개념은 다른 키다", () => {
  assert.notEqual(conceptKeyOf("대칭키 암호"), conceptKeyOf("공개키 기반구조"));
  assert.notEqual(conceptKeyOf("훈민정음"), conceptKeyOf("향가"));
});

test("해설이 없으면 키가 없다", () => {
  // 상한을 걸 근거가 없는 문항이다. 키 없는 것끼리 묶이면 안 된다.
  assert.equal(conceptKeyOf(null), null);
  assert.equal(conceptKeyOf(""), null);
  assert.equal(conceptKeyOf("   "), null);
  assert.equal(sameConcept(null, null), false);
  assert.equal(sameConcept("대칭키", null), false);
  assert.equal(sameConcept("대칭키", "대칭키"), true);
});

test("꼬리말만 남는 제목도 키를 잃지 않는다", () => {
  // 전부 잘라내고 빈 문자열이 되면 그 문항이 상한에서 빠진다. 그러느니 원문을 쓴다.
  assert.ok(conceptKeyOf("정리"));
  assert.ok(conceptKeyOf("개념"));
});

test("한 글자 토막은 개념을 가르지 못하므로 건너뛴다", () => {
  // "법 적용의 원칙"에서 "법"을 키로 잡으면 법 관련 문항이 통째로 한 묶음이 된다.
  assert.equal(conceptKeyOf("법 적용의 원칙"), "적용");
});

test("파생 접미사를 최소한으로 자른다", () => {
  assert.equal(conceptKeyOf("암호화 기법"), conceptKeyOf("암호 기법"));
  // 두 글자 이하로 줄어드는 절단은 하지 않는다(과잉 절단 방지).
  assert.equal(conceptKeyOf("성 평등"), "성 평등".split(" ")[1]);
});

test("같은 입력이면 같은 키가 나온다", () => {
  // 큐 편성이 결정적이어야 하므로 이 함수도 결정적이어야 한다.
  assert.equal(conceptKeyOf("대칭키 암호"), conceptKeyOf("대칭키 암호"));
});
