import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampMixLimit,
  labelMixSessions,
  mixSessionTitle,
  pickMixQuestions,
  MIX_DEFAULT_LIMIT,
  MIX_MAX_LIMIT,
  MIX_MIN_LIMIT,
  type MixCandidate,
} from "./mix-practice";
import { kstDayKey } from "./format";

// 섞기를 끄면(rand = 0) 배분이 결정적이 되어 "어느 문제지가 독점하는가",
// "안 푼 문항이 먼저 나오는가"를 그대로 검증할 수 있다.
const noShuffle = () => 0;

function paper(id: string, count: number): MixCandidate[] {
  return Array.from({ length: count }, (_, i) => ({ paperId: id, questionNumber: i + 1 }));
}

test("문항 수는 최소·최대 사이로 정리되고 이상한 값은 기본값", () => {
  assert.equal(clampMixLimit(20), 20);
  assert.equal(clampMixLimit("35"), 35);
  assert.equal(clampMixLimit(1), MIX_MIN_LIMIT);
  assert.equal(clampMixLimit(9999), MIX_MAX_LIMIT);
  assert.equal(clampMixLimit("abc"), MIX_DEFAULT_LIMIT);
  assert.equal(clampMixLimit(undefined), MIX_DEFAULT_LIMIT);
  assert.equal(clampMixLimit(12.6), 13);
});

test("문항이 많은 문제지가 세션을 독점하지 않는다 — 문제지 라운드로빈", () => {
  const candidates = [...paper("big", 40), ...paper("small-a", 3), ...paper("small-b", 3)];
  const { picked } = pickMixQuestions(candidates, 12, new Set(), noShuffle);
  assert.equal(picked.length, 12);
  const byPaper = new Map<string, number>();
  for (const p of picked) byPaper.set(p.paperId, (byPaper.get(p.paperId) ?? 0) + 1);
  // 작은 문제지 둘은 전부(3+3) 들어가고 나머지 6이 큰 문제지 몫이다.
  assert.equal(byPaper.get("small-a"), 3);
  assert.equal(byPaper.get("small-b"), 3);
  assert.equal(byPaper.get("big"), 6);
});

test("안 푼 문항을 먼저 내고, 모자랄 때만 푼 문항으로 채운다", () => {
  const candidates = [...paper("p1", 5), ...paper("p2", 5)];
  const seen = new Set(["p1#1", "p1#2", "p1#3", "p2#1", "p2#2", "p2#3"]);
  const { picked, unseenCount, coveredAll } = pickMixQuestions(
    candidates,
    6,
    seen,
    noShuffle,
  );
  assert.equal(picked.length, 6);
  // 안 푼 문항은 4개(p1#4,5 / p2#4,5)뿐 — 그 넷은 반드시 들어간다.
  const keys = new Set(picked.map((p) => `${p.paperId}#${p.questionNumber}`));
  for (const k of ["p1#4", "p1#5", "p2#4", "p2#5"]) assert.ok(keys.has(k), k);
  assert.equal(unseenCount, 4);
  assert.equal(coveredAll, true);
});

test("안 푼 문항이 넉넉하면 푼 문항은 섞이지 않는다", () => {
  const candidates = [...paper("p1", 30), ...paper("p2", 30)];
  const seen = new Set(["p1#1", "p2#1"]);
  const { picked, coveredAll } = pickMixQuestions(candidates, 20, seen, noShuffle);
  assert.equal(picked.length, 20);
  for (const p of picked) assert.ok(!seen.has(`${p.paperId}#${p.questionNumber}`));
  assert.equal(coveredAll, false);
});

test("같은 문항이 두 번 나오지 않고 후보보다 많이 뽑지 않는다", () => {
  const candidates = paper("only", 7);
  const { picked } = pickMixQuestions(candidates, 20, new Set(), Math.random);
  assert.equal(picked.length, 7);
  assert.equal(new Set(picked.map((p) => p.questionNumber)).size, 7);
});

test("제목은 한국 시간 날짜로 '9월 5일 섞어풀기'", () => {
  // UTC 로는 9월 4일 저녁이지만 KST 로는 9월 5일 새벽.
  assert.equal(mixSessionTitle("2026-09-04T16:30:00Z"), "9월 5일 섞어풀기");
  assert.equal(mixSessionTitle("2026-09-04T16:30:00Z", 2), "9월 5일 섞어풀기 (2)");
  assert.equal(mixSessionTitle("not-a-date"), "섞어풀기");
});

test("같은 날 세션은 만든 순서대로 (2), (3)이 붙는다", () => {
  const titles = labelMixSessions(
    [
      { id: "c", createdAt: "2026-09-05T10:00:00+09:00" },
      { id: "a", createdAt: "2026-09-05T08:00:00+09:00" },
      { id: "b", createdAt: "2026-09-05T09:00:00+09:00" },
      { id: "d", createdAt: "2026-09-06T09:00:00+09:00" },
    ],
    kstDayKey,
  );
  assert.equal(titles.get("a"), "9월 5일 섞어풀기");
  assert.equal(titles.get("b"), "9월 5일 섞어풀기 (2)");
  assert.equal(titles.get("c"), "9월 5일 섞어풀기 (3)");
  assert.equal(titles.get("d"), "9월 6일 섞어풀기");
});
