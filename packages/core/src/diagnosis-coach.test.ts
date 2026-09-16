import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoachingItems } from "./diagnosis-coach";

// 모델 응답을 화면 데이터로 되돌리는 지점. 배치 경로에서는 이 파싱이 **제출 몇 시간 뒤**
// 에 일어나므로, 여기서 조용히 빈 배열을 돌려주면 그 주기의 극복법이 통째로 사라진다
// (그리고 배치 요금은 이미 나갔다). 그래서 "무엇을 버리고 무엇을 남기는지"를 못 박아 둔다.

const targets = [
  {
    concept: "서브넷 마스크 계산",
    conceptId: "c-subnet",
    subject: "컴퓨터일반",
    subjectSlug: "computer",
  },
  { concept: "행정행위의 하자", conceptId: null, subject: "행정법총론", subjectSlug: "admin-law" },
];

function body(items: unknown) {
  return JSON.stringify({ items });
}

test("정상 응답은 우리 데이터의 과목·slug·개념 id를 붙여 돌려준다", () => {
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
  // subjectSlug·conceptId 는 모델이 아니라 우리 데이터에서 온다(모델에게 id 를 짓게 하지 않는다).
  assert.equal(out[0].subjectSlug, "computer");
  assert.equal(out[0].subject, "컴퓨터일반");
  assert.equal(out[0].conceptId, "c-subnet");
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

// ── 깊어진 진단(원인·문항별 근거·계획·체크리스트) ────────────────────────────
// 이 필드들이 이 기능이 파는 것 자체다. 조용히 사라지면 화면은 예전처럼 두 문장만
// 그리고, 사용자는 프리미엄 값을 내고 개념 설명을 받는다.

test("원인·근거·계획·체크리스트를 그대로 싣는다", () => {
  const out = parseCoachingItems(
    body([
      {
        concept: "행정행위의 하자",
        weakPattern: "무효와 취소를 섞어요.",
        howToOvercome: "판단 순서를 고정하세요.",
        rootCause: "중대·명백을 '중대하기만 하면'으로 읽고 있어요.",
        evidence: [
          { question: "무효인 처분을 고르는 문제", myChoice: "3번 — 취소 사유", insight: "명백성을 빼고 판단했어요." },
          { question: "하자의 승계 문제", myChoice: null, insight: "선행·후행 처분의 목적 동일성을 안 봤어요." },
        ],
        steps: [
          { title: "판단 순서 적기", detail: "중대성 → 명백성 순으로 두 줄 메모", minutes: 10 },
          { title: "오답 5문항 다시 풀기", detail: "같은 순서로 판단해 보기", minutes: 25 },
        ],
        checkpoints: ["중대성부터 확인", "명백성 따로 확인"],
        trap: "'중대하면 무효'로 넘어가는 선지",
      },
    ]),
    targets,
  );
  assert.equal(out.length, 1);
  const c = out[0];
  assert.equal(c.rootCause, "중대·명백을 '중대하기만 하면'으로 읽고 있어요.");
  assert.equal(c.evidence?.length, 2);
  // 응시 기록이 없어 무엇을 골랐는지 모르는 문항은 null 그대로 둔다(지어내지 않는다).
  assert.equal(c.evidence?.[1].myChoice, null);
  assert.equal(c.steps?.[0].minutes, 10);
  assert.deepEqual(c.checkpoints, ["중대성부터 확인", "명백성 따로 확인"]);
  assert.equal(c.trap, "'중대하면 무효'로 넘어가는 선지");
});

test("새 필드가 없거나 깨져도 두 문장짜리 극복법은 살린다", () => {
  // 구버전 리포트·부실한 응답. 여기서 통째로 버리면 그 주기가 빈다 — 요금은 이미 나갔다.
  const out = parseCoachingItems(
    body([
      {
        concept: "행정행위의 하자",
        weakPattern: "무효와 취소를 섞어요.",
        howToOvercome: "판단 순서를 고정하세요.",
        evidence: "배열이 아님",
        steps: [{ title: "제목만 있고", detail: "  " }],
        checkpoints: ["", "   "],
      },
    ]),
    targets,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].rootCause, null);
  assert.equal(out[0].evidence, null);
  // 내용이 빈 단계·체크리스트는 버린다(빈 줄만 그려지는 카드가 되지 않게).
  assert.equal(out[0].steps, null);
  assert.equal(out[0].checkpoints, null);
});

test("배열이 상한을 넘으면 잘라서 싣는다", () => {
  const evidence = Array.from({ length: 12 }, (_, i) => ({
    question: `문항 ${i}`,
    myChoice: null,
    insight: "근거",
  }));
  const checkpoints = Array.from({ length: 12 }, (_, i) => `확인 ${i}`);
  const out = parseCoachingItems(
    body([
      {
        concept: "행정행위의 하자",
        weakPattern: "무효와 취소를 섞어요.",
        howToOvercome: "판단 순서를 고정하세요.",
        evidence,
        checkpoints,
      },
    ]),
    targets,
  );
  assert.ok((out[0].evidence?.length ?? 0) <= 6, `근거 ${out[0].evidence?.length}개`);
  assert.ok((out[0].checkpoints?.length ?? 0) <= 5, `체크리스트 ${out[0].checkpoints?.length}개`);
});

test("소요 시간이 이상하면 그 값만 버리고 단계는 살린다", () => {
  const out = parseCoachingItems(
    body([
      {
        concept: "행정행위의 하자",
        weakPattern: "무효와 취소를 섞어요.",
        howToOvercome: "판단 순서를 고정하세요.",
        steps: [{ title: "판단 순서 적기", detail: "두 줄 메모", minutes: "십 분" }],
      },
    ]),
    targets,
  );
  assert.equal(out[0].steps?.length, 1);
  assert.equal(out[0].steps?.[0].minutes, null);
});
