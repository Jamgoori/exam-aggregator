import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoachingItems } from "@/lib/diagnosis-coach";

// 모델 응답을 화면 데이터로 되돌리는 지점. 배치 경로에서는 이 파싱이 **제출 몇 시간 뒤**
// 에 일어나므로, 여기서 조용히 빈 배열을 돌려주면 그 주기의 극복법이 통째로 사라진다
// (그리고 배치 요금은 이미 나갔다). 그래서 "무엇을 버리고 무엇을 남기는지"를 못 박아 둔다.

const targets = [
  { concept: "서브넷 마스크 계산", subject: "컴퓨터일반", subjectSlug: "computer" },
  { concept: "행정행위의 하자", subject: "행정법총론", subjectSlug: "admin-law" },
];

function body(items: unknown) {
  return JSON.stringify({ items });
}

test("정상 응답은 우리 데이터의 과목·slug를 붙여 돌려준다", () => {
  const out = parseCoachingItems(
    body([
      {
        concept: "서브넷 마스크 계산",
        weakPattern: " 호스트 수를 먼저 잡고 비트를 세는 순서에서 어긋나요. ",
        howToOvercome: "표를 그리지 말고 2의 거듭제곱부터 적어보세요.",
      },
    ]),
    targets,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].concept, "서브넷 마스크 계산");
  // subjectSlug 는 모델이 아니라 우리 데이터에서 온다(모델에게 slug 를 짓게 하지 않는다).
  assert.equal(out[0].subjectSlug, "computer");
  assert.equal(out[0].subject, "컴퓨터일반");
  assert.equal(out[0].weakPattern, "호스트 수를 먼저 잡고 비트를 세는 순서에서 어긋나요.");
});

test("물어보지 않은 개념은 버린다", () => {
  const out = parseCoachingItems(
    body([
      { concept: "삼권분립", weakPattern: "지어낸 개념", howToOvercome: "지어낸 조언" },
      { concept: "행정행위의 하자", weakPattern: "무효와 취소를 섞어요", howToOvercome: "판단 순서를 고정하세요" },
    ]),
    targets,
  );
  assert.deepEqual(
    out.map((c) => c.concept),
    ["행정행위의 하자"],
  );
});

test("두 문장 중 하나라도 비면 그 개념은 버린다", () => {
  const out = parseCoachingItems(
    body([{ concept: "행정행위의 하자", weakPattern: "  ", howToOvercome: "판단 순서를 고정하세요" }]),
    targets,
  );
  assert.equal(out.length, 0);
});

test("깨진 JSON·빈 응답은 던지지 않고 빈 배열", () => {
  // 배치 결과가 잘려 오거나(max_tokens) 빈 텍스트로 오는 경우. 예외를 던지면 그 배치에
  // 같이 실린 **다른 사용자들의 수거까지** 함께 죽는다.
  assert.deepEqual(parseCoachingItems('{"items": [', targets), []);
  assert.deepEqual(parseCoachingItems("", targets), []);
  assert.deepEqual(parseCoachingItems(body(undefined), targets), []);
});
