import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchCustomId,
  mergeConceptResults,
  parseBatchCustomId,
  type ConceptResult,
} from "@/lib/diagnosis-batch-merge";

// 배치 경로의 "개념 1개 = 요청 1건" 규칙. 여기서 어긋나면 사고가 나는 자리는 수거 시점
// (제출 몇 분 뒤)이라 화면에서 재현하기 어렵다 — custom_id 를 잘못 되읽으면 남의 진단에
// 극복법이 붙고, 합치기가 틀리면 개념 순서가 뒤바뀌거나 절반만 저장된다.

const DIAG = "7a1a5b1e-3c1d-4b3f-9e2a-1f0c2d3e4f5a";

const targets = [
  { concept: "서브넷 마스크 계산", conceptId: "c-subnet", subject: "컴퓨터일반", subjectSlug: "computer" },
  { concept: "행정행위의 하자", conceptId: null, subject: "행정법총론", subjectSlug: "admin-law" },
  { concept: "정보보호 3요소", conceptId: "c-cia", subject: "정보보호론", subjectSlug: "infosec" },
];

function ok(concept: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    items: [{ concept, weakPattern: `${concept}에서 무너져요.`, howToOvercome: "순서를 고정하세요.", ...extra }],
  });
}

test("custom_id 는 진단 행 id 뒤에 개념 순번을 붙이고, 그대로 되읽힌다", () => {
  const id = batchCustomId(DIAG, 2);
  assert.equal(id, `${DIAG}_2`);
  // Message Batches 의 custom_id 제약: 영숫자·'_'·'-' 만, 64자 이내.
  assert.match(id, /^[A-Za-z0-9_-]{1,64}$/);
  assert.deepEqual(parseBatchCustomId(id), { prefix: DIAG, index: 2 });
});

test("순번이 없는 구형 custom_id(진단 행 id 그대로)는 index null 로 읽는다", () => {
  // 이 설계 이전에 낸 배치는 진단 하나가 요청 하나였다. 배포 시점에 처리 중이던 그 배치도
  // 수거해야 하므로 UUID 의 '-' 를 구분자로 오해하면 안 된다.
  assert.deepEqual(parseBatchCustomId(DIAG), { prefix: DIAG, index: null });
});

test("개념별 결과는 도착 순서와 무관하게 물어본 순서로 합쳐진다", () => {
  const results: ConceptResult[] = [
    { index: 2, status: "succeeded", text: ok("정보보호 3요소") },
    { index: 0, status: "succeeded", text: ok("서브넷 마스크 계산") },
    { index: 1, status: "succeeded", text: ok("행정행위의 하자") },
  ];
  const merged = mergeConceptResults(results, targets);
  assert.deepEqual(
    merged.coaching.map((c) => c.concept),
    ["서브넷 마스크 계산", "행정행위의 하자", "정보보호 3요소"],
  );
  // subjectSlug·conceptId 는 모델이 아니라 우리 데이터(targets)에서 붙는다.
  assert.equal(merged.coaching[0].conceptId, "c-subnet");
  assert.equal(merged.coaching[2].subjectSlug, "infosec");
  assert.deepEqual(merged.failures, []);
});

test("한 요청이 실패해도 나머지 개념은 남고, 실패 사유는 개념 이름으로 남는다", () => {
  const results: ConceptResult[] = [
    { index: 0, status: "succeeded", text: ok("서브넷 마스크 계산") },
    { index: 1, status: "errored", text: "" },
    // 성공했지만 본문이 잘려 파싱이 안 되는 경우(max_tokens).
    { index: 2, status: "succeeded", text: '{"items": [' },
  ];
  const merged = mergeConceptResults(results, targets);
  assert.deepEqual(
    merged.coaching.map((c) => c.concept),
    ["서브넷 마스크 계산"],
  );
  assert.equal(merged.failures.length, 2);
  assert.match(merged.failures[0], /행정행위의 하자.*errored/);
  assert.match(merged.failures[1], /정보보호 3요소.*만들지 못함/);
});

test("결과 파일에 아예 없는 개념은 '배치 결과에 없음' 으로 남는다", () => {
  const merged = mergeConceptResults(
    [{ index: 0, status: "succeeded", text: ok("서브넷 마스크 계산") }],
    targets,
  );
  assert.equal(merged.coaching.length, 1);
  assert.deepEqual(merged.failures, [
    "행정행위의 하자: 배치 결과에 없음",
    "정보보호 3요소: 배치 결과에 없음",
  ]);
});

test("요청이 맡지 않은 개념을 모델이 끼워 넣으면 버린다", () => {
  // 개념 0 을 맡은 요청이 개념 1 의 극복법까지 써 보내도 그 요청의 개념만 받는다 —
  // 그 개념은 자기 요청(표본을 제대로 본)이 따로 만든다.
  const text = JSON.stringify({
    items: [
      { concept: "서브넷 마스크 계산", weakPattern: "비트 세기", howToOvercome: "표 그리기" },
      { concept: "행정행위의 하자", weakPattern: "표본도 안 본 추측", howToOvercome: "지어낸 조언" },
    ],
  });
  const merged = mergeConceptResults(
    [
      { index: 0, status: "succeeded", text },
      { index: 1, status: "succeeded", text: ok("행정행위의 하자", { weakPattern: "무효와 취소를 섞어요." }) },
    ],
    targets.slice(0, 2),
  );
  assert.deepEqual(
    merged.coaching.map((c) => c.weakPattern),
    ["비트 세기", "무효와 취소를 섞어요."],
  );
});

test("구형 결과(한 응답에 모든 개념)도 같은 규칙으로 합친다", () => {
  const text = JSON.stringify({
    items: [
      { concept: "행정행위의 하자", weakPattern: "무효와 취소를 섞어요.", howToOvercome: "순서 고정" },
      { concept: "서브넷 마스크 계산", weakPattern: "비트 세기", howToOvercome: "표 그리기" },
    ],
  });
  const merged = mergeConceptResults([{ index: null, status: "succeeded", text }], targets);
  // 물어본 순서로 정렬되고, 응답에 빠진 개념은 실패로 남는다.
  assert.deepEqual(
    merged.coaching.map((c) => c.concept),
    ["서브넷 마스크 계산", "행정행위의 하자"],
  );
  assert.deepEqual(merged.failures, ["정보보호 3요소: 모델이 극복법을 만들지 못함"]);
});

test("범위 밖 순번은 무시하고, 전부 실패하면 극복법이 비어 있다", () => {
  const merged = mergeConceptResults(
    [
      { index: 9, status: "succeeded", text: ok("서브넷 마스크 계산") },
      { index: 0, status: "expired", text: "" },
    ],
    targets.slice(0, 1),
  );
  assert.deepEqual(merged.coaching, []);
  assert.deepEqual(merged.failures, ["서브넷 마스크 계산: 배치 결과가 expired 상태"]);
});

test("과목이 다른 동명 개념은 각자 자기 요청의 결과를 받는다", () => {
  // 표시 이름(keyword_title)은 과목이 다르면 겹칠 수 있고, 선택창은 둘 다 고를 수 있다.
  // 이름으로 되찾으면 두 결과가 첫 자리에 겹쳐 하나가 사라진다.
  const twins = [
    { concept: "비례의 원칙", conceptId: "c-admin", subject: "행정법총론", subjectSlug: "admin-law" },
    { concept: "비례의 원칙", conceptId: "c-const", subject: "헌법", subjectSlug: "constitution" },
  ];
  const merged = mergeConceptResults(
    [
      { index: 1, status: "succeeded", text: ok("비례의 원칙", { weakPattern: "헌법 쪽" }) },
      { index: 0, status: "succeeded", text: ok("비례의 원칙", { weakPattern: "행정법 쪽" }) },
    ],
    twins,
  );
  assert.deepEqual(
    merged.coaching.map((c) => [c.conceptId, c.weakPattern]),
    [
      ["c-admin", "행정법 쪽"],
      ["c-const", "헌법 쪽"],
    ],
  );
  assert.deepEqual(merged.failures, []);
});
