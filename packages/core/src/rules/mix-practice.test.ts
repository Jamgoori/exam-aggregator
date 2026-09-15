import { test } from "node:test";
import assert from "node:assert/strict";
import { embedOne, toMixSessionBriefs, type MixSessionRow } from "./mix-practice";

// 2026-09-05 프로덕션 사고: /mix 가 로그인 사용자에게만 500 이었다(익명은 CDN 캐시본을
// 받아 멀쩡해 보였다). 원인은 PostgREST 임베드가 배열로 와서 subjects.slug 가 조용히
// undefined 가 된 것 — 그 값이 색 해시(subjectColorIndex → undefined.length)로 들어가
// 페이지를 통째로 떨어뜨렸다. 임베드 모양은 조회마다 달라질 수 있으니 규칙을 못 박는다.

function row(over: Partial<MixSessionRow> = {}): MixSessionRow {
  return {
    id: "s1",
    created_at: "2026-09-05T09:00:00+09:00",
    score: 8,
    total_questions: 10,
    subjects: { slug: "korean", name: "국어" },
    ...over,
  };
}

test("임베드가 객체로 와도 배열로 와도 같은 결과", () => {
  const asObject = toMixSessionBriefs([row()], 5);
  const asArray = toMixSessionBriefs([row({ subjects: [{ slug: "korean", name: "국어" }] })], 5);
  assert.equal(asObject[0].subjectSlug, "korean");
  assert.deepEqual(asArray, asObject);
});

test("과목을 못 찾은 세션은 목록에서 빠진다 — slug 없이 그리면 화면이 죽는다", () => {
  const rows = [
    row({ id: "a", subjects: null }),
    row({ id: "b", subjects: [] }),
    row({ id: "c", subjects: { slug: "", name: "" } }),
    row({ id: "d" }),
  ];
  const briefs = toMixSessionBriefs(rows, 5);
  assert.deepEqual(briefs.map((b) => b.id), ["d"]);
  for (const b of briefs) assert.ok(b.subjectSlug.length > 0);
});

test("같은 날 순번은 표시 개수(limit)가 아니라 받아온 전체 기준으로 매긴다", () => {
  // limit 만큼 자른 뒤 이름을 붙이면, 최신 세션이 "(1)"로 보인다.
  const rows = [
    row({ id: "new", created_at: "2026-09-05T11:00:00+09:00" }),
    row({ id: "mid", created_at: "2026-09-05T10:00:00+09:00" }),
    row({ id: "old", created_at: "2026-09-05T09:00:00+09:00" }),
  ];
  const briefs = toMixSessionBriefs(rows, 1);
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0].id, "new");
  assert.equal(briefs[0].title, "9월 5일 섞어풀기 (3)");
});

test("embedOne: 배열이면 첫 항목, 비었거나 없으면 null", () => {
  assert.deepEqual(embedOne({ a: 1 }), { a: 1 });
  assert.deepEqual(embedOne([{ a: 1 }, { a: 2 }]), { a: 1 });
  assert.equal(embedOne([]), null);
  assert.equal(embedOne(null), null);
  assert.equal(embedOne(undefined), null);
});
