import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildConceptDrafts,
  buildConceptLookup,
  matchConcept,
  normalizeConceptAlias,
  summarizeConceptHealth,
  validateConceptSpec,
  CONCEPT_MAX_SHARE_BY_KIND,
  CONCEPT_MIN_QUESTIONS,
} from "./concept-dictionary";

// 이 축은 약점 진단이 쓰게 된다. 잘못 붙으면 사용자에게 "대칭키가 약합니다"라고
// 틀린 말을 하게 되므로, concept-key.ts 와 달리 "모르면 안 붙인다"가 원칙이다.

test("별칭으로 붙인다", () => {
  const lookup = buildConceptLookup([
    { conceptId: "c1", alias: "대칭키 암호" },
    { conceptId: "c1", alias: "대칭키 암호화 방식" },
    { conceptId: "c2", alias: "공개키 기반구조" },
  ]);

  assert.deepEqual(matchConcept("대칭키 암호화 방식", lookup), {
    conceptId: "c1",
    via: "alias",
  });
  assert.deepEqual(matchConcept("공개키 기반구조", lookup), {
    conceptId: "c2",
    via: "alias",
  });
});

test("띄어쓰기·구두점만 다른 표기는 같은 별칭으로 본다", () => {
  const lookup = buildConceptLookup([{ conceptId: "c1", alias: "대칭키 암호" }]);
  assert.equal(matchConcept("대칭키암호", lookup).conceptId, "c1");
  assert.equal(matchConcept("  대칭키·암호  ", lookup).conceptId, "c1");
  assert.equal(normalizeConceptAlias("대칭키 암호(블록)"), "대칭키암호블록");
});

test("별칭에 없는 새 표기는 그룹 키로 한 번 더 잡는다", () => {
  // 해설 배치는 앞으로도 자유 문자열을 만든다. 2차 그물이 없으면 새 표기가 전부
  // 미매칭으로 쏟아진다.
  const lookup = buildConceptLookup([{ conceptId: "c1", alias: "대칭키 암호" }]);
  assert.deepEqual(matchConcept("대칭키 알고리즘 종류", lookup), {
    conceptId: "c1",
    via: "key",
  });
});

test("한 그룹 키에 정본이 둘이면 그 키로는 붙이지 않는다", () => {
  // "행정행위의 하자"와 "행정행위의 취소"는 그룹 키가 같다. 큐 다양성에는 그게
  // 맞지만, 진단 축에서 찍어서 붙이면 틀린 말을 하게 된다.
  const lookup = buildConceptLookup([
    { conceptId: "c1", alias: "행정행위의 하자" },
    { conceptId: "c2", alias: "행정행위의 취소" },
  ]);

  // 등록된 표기는 별칭으로 정확히 붙는다.
  assert.equal(matchConcept("행정행위의 하자", lookup).conceptId, "c1");
  // 새 표기는 어느 쪽인지 모르므로 미매칭이다.
  assert.deepEqual(matchConcept("행정행위의 무효", lookup), {
    conceptId: null,
    via: "none",
  });
});

test("모르면 안 붙인다", () => {
  const lookup = buildConceptLookup([{ conceptId: "c1", alias: "대칭키 암호" }]);
  assert.deepEqual(matchConcept("훈민정음 창제", lookup), { conceptId: null, via: "none" });
  assert.deepEqual(matchConcept(null, lookup), { conceptId: null, via: "none" });
  assert.deepEqual(matchConcept("   ", lookup), { conceptId: null, via: "none" });
});

test("초안: 가장 많이 쓰인 표기를 이름 후보로 세운다", () => {
  const drafts = buildConceptDrafts([
    { title: "대칭키 암호화 방식", count: 3 },
    { title: "대칭키 암호", count: 9 },
    { title: "공개키 기반구조", count: 4 },
  ]);

  assert.equal(drafts[0].name, "대칭키 암호");
  assert.equal(drafts[0].count, 12);
  assert.equal(drafts[0].aliases.length, 2);
  // 문항이 많은 묶음이 먼저 — 사람이 위에서부터 손보게 한다.
  assert.deepEqual(
    drafts.map((d) => d.name),
    ["대칭키 암호", "공개키 기반구조"],
  );
});

test("초안은 확정이 아니다(같은 그룹 키는 한 묶음으로 낸다)", () => {
  // 진단 축으로 쓰려면 사람이 쪼개야 하는 자리다. 그걸 알 수 있게 별칭을 다 남긴다.
  const drafts = buildConceptDrafts([
    { title: "행정행위의 하자", count: 5 },
    { title: "행정행위의 취소", count: 4 },
  ]);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].aliases.length, 2);
});

test("검증: 커버리지·얇은 개념·편중을 함께 낸다", () => {
  const health = summarizeConceptHealth(
    [
      { conceptId: "c1", via: "alias" },
      { conceptId: "c1", via: "alias" },
      { conceptId: "c1", via: "key" },
      { conceptId: "c2", via: "alias" },
      { conceptId: null, via: "none" },
    ],
    2,
  );

  assert.equal(health.matched, 4);
  assert.equal(health.viaKey, 1);
  assert.equal(health.unmatched, 1);
  assert.equal(health.coverage, 0.8);
  // c2는 1문항 — 진단 표본이 안 나오는 개념이다.
  assert.equal(health.thinConcepts, 1);
  assert.equal(health.maxConceptShare, 0.75);
  assert.ok(CONCEPT_MIN_QUESTIONS >= 3);
});

test("기능형 개념은 비중이 커도 정상이다", () => {
  // 영어 빈칸추론은 실제로 시험지의 큰 비중을 차지한다. 지식형 기준(20%)을 그대로
  // 들이대면 "쪼개라"는 잘못된 신호가 나온다 — 쪼갤 수 없는 축이다.
  // 12문항 중 빈칸추론 4개 = 33%. 지식형 상한(20%)은 넘지만 기능형 상한(50%)은 넘지
  // 않는 — 두 기준이 갈리는 구간이다.
  const matches = [
    ...Array.from({ length: 4 }, () => ({ conceptId: "빈칸추론", via: "alias" as const })),
    ...Array.from({ length: 8 }, (_, i) => ({ conceptId: `기타${i % 4}`, via: "alias" as const })),
  ];
  assert.ok(CONCEPT_MAX_SHARE_BY_KIND.skill > CONCEPT_MAX_SHARE_BY_KIND.knowledge);

  const asSkill = summarizeConceptHealth(matches, 5, 3, (id) =>
    id === "빈칸추론" ? "skill" : "knowledge",
  );
  assert.equal(asSkill.overSizedConcepts.length, 0);

  // 같은 분포라도 지식형이면 입도가 거친 것이다.
  const asKnowledge = summarizeConceptHealth(matches, 5, 3);
  assert.equal(asKnowledge.overSizedConcepts.length, 1);
  assert.equal(asKnowledge.overSizedConcepts[0].conceptId, "빈칸추론");
});

test("정본 목록 검증: 같은 과목 안 별칭 겹침은 오류다", () => {
  // DB 가 거절한다. 등록이 중간에 멈추면 일부 문항만 붙은 채로 남으므로 넣기 전에
  // 잡아야 한다.
  const report = validateConceptSpec({
    영어: [
      { name: "빈칸추론", kind: "skill", aliases: ["빈칸 추론"] },
      { name: "연결어", kind: "skill", aliases: ["빈칸 추론"] },
    ],
  });
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0].message, /별칭이 겹친다/);
});

test("정본 목록 검증: 과목이 다르면 같은 별칭을 써도 된다", () => {
  // 독해 기능형은 과목마다 같은 이름을 쓴다. 국어 "내용 일치"와 영어 "내용 일치"는
  // 서로 다른 개념이고, 이걸 막으면 이름에 과목 접두를 붙이게 된다.
  const report = validateConceptSpec({
    국어: [{ name: "세부 내용 일치", kind: "skill", aliases: ["내용 일치"] }],
    영어: [{ name: "내용 일치", kind: "skill", aliases: ["글의 내용과 일치"] }],
  });
  assert.deepEqual(report.errors, []);
});

test("정본 목록 검증: 이름 중복과 잘못된 kind", () => {
  const report = validateConceptSpec({
    국어: [
      { name: "음운 변동" },
      { name: "음운 변동" },
      { name: "품사", kind: "느낌" },
    ],
  });
  assert.equal(report.errors.filter((e) => /중복/.test(e.message)).length, 1);
  assert.equal(report.errors.filter((e) => /kind/.test(e.message)).length, 1);
});

test("정본 목록 검증: 그룹 키를 나눠 가지면 경고한다", () => {
  // 2차 그물이 꺼진다는 뜻이라 새 표기가 전부 미매칭으로 쏟아진다. 오류는 아니다 —
  // 진단 축에서는 쪼개는 게 맞을 때가 많다.
  const report = validateConceptSpec({
    행정법: [{ name: "행정행위의 하자" }, { name: "행정행위의 취소" }],
  });
  assert.ok(report.warnings.some((w) => /그룹 키/.test(w.message)));
  assert.equal(report.errors.length, 0);
});

test("정본 목록 검증: 단원과 개념 이름이 같으면 오류다", () => {
  // 단원도 concepts 행이라 (subject_id, lower(name)) 유일 인덱스에 걸린다. 등록할 때
  // 둘 중 하나가 조용히 빠지고, 화면에는 아무 표시도 안 난다.
  const report = validateConceptSpec({
    영어: [{ name: "생활영어", unit: "생활영어", kind: "skill" }],
  });
  assert.ok(report.errors.some((e) => /단원과 개념 이름이 같다/.test(e.message)));
});
