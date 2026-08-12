import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeConceptAlias as coreNormalize } from "@gongmoa/core";

// 해설 배치 스크립트 2개(next-explanation-chunk.mjs / save-explanations.mjs)의 개념
// 관련 로직을 검증한다.
//
// 왜 스크립트를 직접 import 하지 않고 사본을 만드는가: 두 스크립트는 무인 루틴이
// `node scripts/xxx.mjs` 로 실행하는 진입점이라 최상단에서 main() 을 바로 호출한다.
// 실행 가드(import.meta.url === argv[1])를 넣으면 테스트에서 import 할 수 있지만,
// 그 가드가 어긋나면 루틴이 조용히 0건 저장으로 끝난다 — 이 레포가 이미 겪은 사고
// 유형이다. 그래서 스크립트는 손대지 않고, 소스에서 main() 호출만 떼어낸 사본을
// 만들어 검사한다.
//
// 사본은 node_modules 아래에 둔다. 거기서 import 해야 @supabase/supabase-js 가
// 정상적으로 잡히고, git 에도 안 남는다.

const SCRIPTS = path.resolve(import.meta.dirname, "../../scripts");
const TMP = path.resolve(import.meta.dirname, "../../node_modules/.batch-script-test");

async function importWithoutMain(fileName: string, exportsLine: string) {
  const src = await readFile(path.join(SCRIPTS, fileName), "utf8");
  const stripped = src.replace(/main\(\)\.catch[\s\S]*$/, exportsLine);
  assert.notEqual(stripped, src, `${fileName}: main() 호출을 못 찾았다 (스크립트 구조가 바뀜)`);
  await mkdir(TMP, { recursive: true });
  const target = path.join(TMP, `${fileName}`);
  await writeFile(target, stripped);
  try {
    return await import(target);
  } finally {
    await rm(target, { force: true });
  }
}

test("normalizeConceptAlias 사본이 core 와 같은 규칙이다", async () => {
  // save-explanations.mjs 는 루틴 환경에서 plain node 로 돌아 TypeScript 패키지를
  // import 할 수 없어 사본을 갖고 있다. 사본이 어긋나면 배치가 붙이는 개념과
  // apply-concepts 백필이 붙이는 개념이 조용히 달라진다.
  const mod = await importWithoutMain(
    "save-explanations.mjs",
    "export { resolveConcepts, normalizeConceptAlias };\n",
  );

  for (const s of [
    "대칭키 암호",
    "  대칭키·암호  ",
    "대칭키 암호(블록)",
    "PKI/공개키 기반구조",
    "글의 순서·삽입",
    "Function Point 산정",
    "행정행위의 하자 — 무효",
    "빈칸 추론 [고난도]",
  ]) {
    assert.equal(mod.normalizeConceptAlias(s), coreNormalize(s), `정규화 불일치: ${s}`);
  }
});

// ── save-explanations: 이름 → concept_id ────────────────────────────────────

const SUBJ_KOR = "subj-kor";
const SUBJ_ENG = "subj-eng";
const SUBJ_NEW = "subj-new"; // 정본 목록이 아직 없는 과목

function fakeSupabase() {
  const tables: Record<string, Record<string, string>[]> = {
    questions: [
      { id: "q1", paper_id: "p-kor" },
      { id: "q2", paper_id: "p-kor" },
      { id: "q3", paper_id: "p-eng" },
      { id: "q4", paper_id: "p-eng" },
      { id: "q5", paper_id: "p-new" },
      { id: "q6", paper_id: "p-kor" },
    ],
    exam_papers: [
      { id: "p-kor", subject_id: SUBJ_KOR },
      { id: "p-eng", subject_id: SUBJ_ENG },
      { id: "p-new", subject_id: SUBJ_NEW },
    ],
    concept_aliases: [
      { concept_id: "c-kor-ilchi", subject_id: SUBJ_KOR, normalized: "내용일치" },
      { concept_id: "c-kor-eumun", subject_id: SUBJ_KOR, normalized: "음운변동" },
      { concept_id: "c-eng-ilchi", subject_id: SUBJ_ENG, normalized: "내용일치" },
      { concept_id: "c-eng-blank", subject_id: SUBJ_ENG, normalized: "빈칸추론" },
    ],
  };
  return {
    from(table: string) {
      return {
        select() {
          return {
            in(column: string, values: string[]) {
              const set = new Set(values);
              return Promise.resolve({
                data: tables[table].filter((r) => set.has(r[column])),
                error: null,
              });
            },
          };
        },
      };
    },
  };
}

test("개념 이름을 과목 안에서 concept_id 로 바꾼다", async () => {
  const mod = await importWithoutMain(
    "save-explanations.mjs",
    "export { resolveConcepts, normalizeConceptAlias };\n",
  );

  const { byQuestion, report } = await mod.resolveConcepts(fakeSupabase(), [
    { question_id: "q1", concept: "내용 일치" },
    { question_id: "q3", concept: "내용 일치" },
    { question_id: "q4", concept: "빈칸추론" },
    { question_id: "q2", concept: "?사동·피동" },
    { question_id: "q6", concept: "음운 변동론" },
    { question_id: "q5", concept: "무슨 개념" },
    { question_id: "q7" },
  ]);

  // 같은 별칭이라도 과목이 다르면 다른 개념이다. 이게 섞이면 진단이 틀린 말을 한다.
  assert.equal(byQuestion.get("q1"), "c-kor-ilchi");
  assert.equal(byQuestion.get("q3"), "c-eng-ilchi");
  assert.equal(byQuestion.get("q4"), "c-eng-blank");
  assert.equal(report.attached, 3);

  // 안 붙는 것은 셋으로 갈라 보고한다. 뭉치면 사람이 뭘 해야 할지 알 수 없다.
  assert.equal(byQuestion.has("q2"), false);
  assert.deepEqual(
    report.proposed.map((p: { concept: string }) => p.concept),
    ["사동·피동"],
  );
  assert.deepEqual(
    report.unmatched.map((p: { concept: string }) => p.concept),
    ["음운 변동론"],
  );
  assert.equal(report.unmatched[0].example_question_id, "q6");
  // 사전이 없는 과목은 배치가 틀린 게 아니라 사람이 아직 목록을 안 만든 것이다.
  assert.deepEqual(
    report.subjects_without_dictionary.map((p: { concept: string }) => p.concept),
    ["무슨 개념"],
  );
});

test("'?' 를 붙였어도 목록에 있으면 붙인다", async () => {
  const mod = await importWithoutMain(
    "save-explanations.mjs",
    "export { resolveConcepts, normalizeConceptAlias };\n",
  );
  const { byQuestion, report } = await mod.resolveConcepts(fakeSupabase(), [
    { question_id: "q1", concept: "?내용 일치" },
  ]);
  assert.equal(byQuestion.get("q1"), "c-kor-ilchi");
  assert.equal(report.attached, 1);
  assert.equal(report.proposed.length, 0);
});

test("concept 없는 입력은 조회 자체를 안 한다", async () => {
  // 구버전 배치 출력(그리고 개념 목록이 없는 과목)이 그렇다. 여기서 헛조회하면
  // 문항 수만큼 왕복이 늘어난다.
  const mod = await importWithoutMain(
    "save-explanations.mjs",
    "export { resolveConcepts, normalizeConceptAlias };\n",
  );
  const throwing = {
    from() {
      throw new Error("조회하면 안 된다");
    },
  };
  const { byQuestion, report } = await mod.resolveConcepts(throwing, [{ question_id: "q1" }]);
  assert.equal(byQuestion.size, 0);
  assert.equal(report.attached, 0);
});

// ── next-explanation-chunk: 고를 수 있는 개념 목록 ──────────────────────────

test("단원은 빼고 개념만 내려보낸다", async () => {
  const mod = await importWithoutMain(
    "next-explanation-chunk.mjs",
    "export { shapeConceptList };\n",
  );

  const list = mod.shapeConceptList([
    { id: "u1", name: "독해", parent_id: null, kind: "knowledge", merged_into: null },
    { id: "u2", name: "문법", parent_id: null, kind: "knowledge", merged_into: null },
    { id: "c1", name: "빈칸추론", parent_id: "u1", kind: "skill", merged_into: null },
    { id: "c2", name: "내용 일치", parent_id: "u1", kind: "skill", merged_into: null },
    { id: "c3", name: "음운 변동", parent_id: "u2", kind: "knowledge", merged_into: null },
    // 최상위지만 자식이 없다 = 단원이 아니라 "단원 없는 개념". 고를 수 있어야 한다.
    { id: "c4", name: "한자성어", parent_id: null, kind: "knowledge", merged_into: null },
    // 합쳐진 개념은 더 이상 고를 대상이 아니다.
    { id: "c5", name: "옛이름", parent_id: "u2", kind: "knowledge", merged_into: "c3" },
  ]);

  const names = list.map((c: { name: string }) => c.name);
  assert.ok(!names.includes("독해"));
  assert.ok(!names.includes("문법"));
  assert.ok(!names.includes("옛이름"));
  assert.ok(names.includes("한자성어"));
  assert.equal(list.length, 4);

  const blank = list.find((c: { name: string }) => c.name === "빈칸추론");
  assert.equal(blank.unit, "독해");
  // 독해 문항이 지문 주제 대신 기능을 고르려면 kind 가 보여야 한다.
  assert.equal(blank.kind, "skill");
  assert.equal(list.find((c: { name: string }) => c.name === "한자성어").unit, null);

  // 같은 단원끼리 붙어 나온다 — 배치도 사람도 훑기 쉬우라고.
  assert.deepEqual(
    list.map((c: { unit: string | null }) => c.unit),
    [null, "독해", "독해", "문법"],
  );
});
