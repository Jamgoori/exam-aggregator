import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asSupabase, type Row } from "@/lib/test-support/fake-supabase";
import { fetchSubjectFacets } from "@/lib/subject-facets";

// 과목 페이지의 급수·직렬 탭 값. 예전에는 그 과목의 exam_papers 를 두 번 통째로 받아
// 여기서 distinct 를 떴는데 range() 가 없어 1000행에서 조용히 잘렸다 — 문제지가 1000장을
// 넘는 과목이면 뒤쪽에만 있는 급수·직렬이 탭에서 통째로 사라진다.

const SUBJECT = "subj-kor";

// 1,200장. 예전 구현이라면 1000행에서 잘려 뒤쪽 200장에만 있는 값이 사라지는 규모다.
function papers(): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < 1200; i++) {
    rows.push({
      id: `p-${i}`,
      subject_id: SUBJECT,
      // 1100번째부터만 나오는 값 — 절단되면 사라진다.
      level: i >= 1100 ? "5급" : i % 2 === 0 ? "9급" : "7급",
      exam_type_id: i >= 1100 ? "et-rare" : "et-common",
    });
  }
  rows.push({ id: "p-other", subject_id: "subj-other", level: "9급", exam_type_id: "et-other" });
  return rows;
}

test("RPC 가 있으면 종류 수만큼의 행만 받는다", async () => {
  const fake = new FakeSupabase({ exam_papers: papers() });
  fake.rpcHandlers["subject_paper_facets"] = (args) => {
    const id = args.p_subject_id as string;
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const r of fake.tables.exam_papers) {
      if (r.subject_id !== id) continue;
      const key = `${r.level}|${r.exam_type_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ level: r.level, exam_type_id: r.exam_type_id });
    }
    return out;
  };

  const facets = await fetchSubjectFacets(asSupabase(fake), SUBJECT);
  assert.deepEqual([...facets.levels].sort(), ["5급", "7급", "9급"]);
  assert.deepEqual([...facets.examTypeIds].sort(), ["et-common", "et-rare"]);
});

test("RPC 가 없는 환경에서도 1000행에서 잘리지 않는다", async () => {
  const fake = new FakeSupabase({ exam_papers: papers() });

  const facets = await fetchSubjectFacets(asSupabase(fake), SUBJECT);
  assert.ok(facets.levels.includes("5급"), "1100번째 뒤에만 있는 급수가 잡혀야 한다");
  assert.ok(facets.examTypeIds.includes("et-rare"), "1100번째 뒤에만 있는 직렬이 잡혀야 한다");
  assert.deepEqual([...facets.levels].sort(), ["5급", "7급", "9급"]);
});

test("다른 과목의 값은 섞이지 않는다", async () => {
  const fake = new FakeSupabase({ exam_papers: papers() });
  const facets = await fetchSubjectFacets(asSupabase(fake), SUBJECT);
  assert.ok(!facets.examTypeIds.includes("et-other"));
});

test("자료가 없는 과목은 빈 목록", async () => {
  const fake = new FakeSupabase({ exam_papers: papers() });
  const facets = await fetchSubjectFacets(asSupabase(fake), "subj-empty");
  assert.deepEqual(facets, { levels: [], examTypeIds: [] });
});
