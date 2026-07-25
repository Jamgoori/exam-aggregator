import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collapseDuplicatePapers,
  collidingPaperIds,
  paperDedupKey,
  representativePaperIds,
  type DedupablePaper,
  type PaperIdentitySignal,
} from "./dedup-papers";

// 규칙의 정본은 apps/web/docs/agents/dedup-papers.md 다. 그 문서가 "이렇게 동작해야 한다"고
// 못박은 항목을 그대로 시험한다 — 특히 "정답은 잘못된 병합을 막는 안전장치일 뿐 병합의
// 전제조건이 아니다"(정답 미등록 서기보가 안 합쳐지던 버그의 재발 방지).

function paper(over: Partial<DedupablePaper> & { id: string }): DedupablePaper {
  return {
    subject_id: "s-korean",
    exam_type_id: "t-court",
    year: 2026,
    round: 1,
    level: "9급",
    title: "2026 법원직 9급 (전산서기보) 한국사",
    track: "전산서기보",
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

const signal = (over: Partial<PaperIdentitySignal> = {}): PaperIdentitySignal => ({
  questionCount: 0,
  answerSignature: null,
  answerLength: null,
  ...over,
});

test("정답이 없어도 메타데이터가 같으면 합친다", () => {
  const a = paper({ id: "a" });
  const b = paper({ id: "b", track: "사서서기보" });
  assert.equal(collapseDuplicatePapers([a, b]).length, 1);
});

test("합쳐진 대표는 제목에서 직류 접미사를 뗀다", () => {
  const a = paper({ id: "a" });
  const b = paper({ id: "b", track: "사서서기보", title: "2026 법원직 9급 (사서서기보) 한국사" });
  const [rep] = collapseDuplicatePapers([a, b]);
  assert.equal(rep.title, "2026 법원직 9급 한국사");
});

test("합쳐지지 않은 단독 문제지는 제목을 건드리지 않는다", () => {
  const solo = paper({ id: "solo" });
  assert.equal(collapseDuplicatePapers([solo])[0].title, solo.title);
});

test("정답이 둘 다 있고 서로 다르면 분리한다", () => {
  const a = paper({ id: "a" });
  const b = paper({ id: "b", track: "사서서기보" });
  const signals = new Map([
    ["a", signal({ answerSignature: JSON.stringify([[1, 2, 3], []]) })],
    ["b", signal({ answerSignature: JSON.stringify([[4, 5, 6], []]) })],
  ]);
  assert.equal(collapseDuplicatePapers([a, b], signals).length, 2);
});

test("정답이 한쪽에만 있으면 합친다 (정답은 병합의 전제조건이 아니다)", () => {
  const a = paper({ id: "a" });
  const b = paper({ id: "b", track: "사서서기보" });
  const signals = new Map([
    ["a", signal({ answerSignature: JSON.stringify([[1, 2, 3], []]) })],
  ]);
  assert.equal(collapseDuplicatePapers([a, b], signals).length, 1);
});

test("정답이 같으면 합친다", () => {
  const sig = JSON.stringify([[1, 2, 3], []]);
  const a = paper({ id: "a" });
  const b = paper({ id: "b", track: "사서서기보" });
  const signals = new Map([
    ["a", signal({ answerSignature: sig })],
    ["b", signal({ answerSignature: sig })],
  ]);
  assert.equal(collapseDuplicatePapers([a, b], signals).length, 1);
});

test("문항 수가 달라도 그것만으로는 분리하지 않는다 (크롭 미완으로 달라질 수 있음)", () => {
  const a = paper({ id: "a" });
  const b = paper({ id: "b", track: "사서서기보" });
  const signals = new Map([
    ["a", signal({ questionCount: 20 })],
    ["b", signal({ questionCount: 5 })],
  ]);
  assert.equal(collapseDuplicatePapers([a, b], signals).length, 1);
});

test("과목·직렬·연도·회차·급수 중 하나라도 다르면 애초에 안 겹친다", () => {
  const base = paper({ id: "a" });
  const others: DedupablePaper[] = [
    paper({ id: "b", subject_id: "s-english" }),
    paper({ id: "c", exam_type_id: "t-local" }),
    paper({ id: "d", year: 2025 }),
    paper({ id: "e", round: 2 }),
    paper({ id: "f", level: "7급" }),
  ];
  for (const other of others) {
    assert.notEqual(paperDedupKey(base), paperDedupKey(other));
    assert.equal(collapseDuplicatePapers([base, other]).length, 2);
  }
});

test("대표는 문항 많은 쪽을 고른다", () => {
  const a = paper({ id: "a" });
  const b = paper({ id: "b", track: "사서서기보" });
  const signals = new Map([
    ["a", signal({ questionCount: 10 })],
    ["b", signal({ questionCount: 20 })],
  ]);
  const { repByPaperId } = representativePaperIds([a, b], signals);
  assert.equal(repByPaperId.get("a"), "b");
});

test("문항 수가 같으면 정답이 등록된 쪽이 대표", () => {
  const a = paper({ id: "a" });
  const b = paper({ id: "b", track: "사서서기보" });
  const signals = new Map([
    ["a", signal({ questionCount: 20 })],
    ["b", signal({ questionCount: 20, answerSignature: JSON.stringify([[1], []]) })],
  ]);
  assert.equal(representativePaperIds([a, b], signals).repByPaperId.get("a"), "b");
});

test("그 다음 타이브레이커는 먼저 올라온 쪽", () => {
  const older = paper({ id: "zzz", created_at: "2026-01-01T00:00:00Z" });
  const newer = paper({ id: "aaa", created_at: "2026-02-01T00:00:00Z", track: "사서서기보" });
  assert.equal(representativePaperIds([older, newer]).repByPaperId.get("aaa"), "zzz");
});

test("생성 시각까지 같으면 id 가 작은 쪽", () => {
  const a = paper({ id: "aaa" });
  const b = paper({ id: "bbb", track: "사서서기보" });
  assert.equal(representativePaperIds([a, b]).repByPaperId.get("bbb"), "aaa");
});

test("입력 순서를 유지하고 대표가 있던 자리에 남는다", () => {
  const solo = paper({ id: "solo", subject_id: "s-english", title: "2026 법원직 9급 영어" });
  const a = paper({ id: "aaa" });
  const b = paper({ id: "bbb", track: "사서서기보" });
  const out = collapseDuplicatePapers([solo, a, b]);
  assert.deepEqual(
    out.map((p) => p.id),
    ["solo", "aaa"],
  );
});

test("collidingPaperIds 는 2건 이상 묶이는 후보만 돌려준다", () => {
  const a = paper({ id: "a" });
  const b = paper({ id: "b", track: "사서서기보" });
  const solo = paper({ id: "solo", subject_id: "s-english" });
  assert.deepEqual(collidingPaperIds([a, b, solo]).sort(), ["a", "b"]);
});

test("빈 입력에도 안전하다", () => {
  assert.deepEqual(collapseDuplicatePapers([]), []);
  assert.deepEqual(collidingPaperIds([]), []);
});
