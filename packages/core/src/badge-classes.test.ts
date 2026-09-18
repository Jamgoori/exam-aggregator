import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXAM_TYPE_FILLED_CLASSES,
  EXAM_TYPE_OUTLINE_CLASSES,
  EXAM_TYPE_TAB_CLASSES,
  LEVEL_CLASSES,
  PAPERS_GROUP_CLASSES,
  SUBJECT_PALETTE_CLASSES,
  examTypeColor,
  examTypeFilledColor,
  examTypeTabColor,
  getRoundTier,
  levelColor,
  papersGroupColor,
  streakTier,
  subjectColor,
} from "./badge-classes";
import { SUBJECT_PALETTE_SIZE } from "./subject-color";

// 8급·한능검이 한쪽 맵에서만 빠진 채 배포된 적이 있다. 카드에는 회색 폴백이 조용히
// 그려져서 아무도 눈치 못 채므로 여기서 못 박는다.
test("급수 맵에 8급이 있고 폴백은 zinc 다", () => {
  assert.equal(LEVEL_CLASSES["8급"], "bg-teal-600 text-white");
  assert.equal(levelColor("9급"), "bg-blue-600 text-white");
  assert.equal(levelColor("없는급"), "bg-zinc-500 text-white");
});

test("시험 유형 맵 넷이 전부 나가고, 셋(테두리·탭·채움)은 같은 14종을 안다", () => {
  const names = Object.keys(EXAM_TYPE_OUTLINE_CLASSES);
  assert.equal(names.length, 14);
  assert.deepEqual(Object.keys(EXAM_TYPE_TAB_CLASSES), names);
  assert.deepEqual(Object.keys(EXAM_TYPE_FILLED_CLASSES), names);
  assert.ok(names.includes("한능검"));
  assert.equal(examTypeColor("한능검"), "border border-rose-300 text-rose-700");
  assert.equal(examTypeTabColor("한능검"), "border border-rose-300 bg-rose-50 text-rose-700");
  assert.equal(examTypeFilledColor("한능검"), "bg-rose-600 text-white");
  // 네 번째 맵(/papers 묶음 버튼)은 셋 뿐이고 filled 와 값이 다르다 — 합치면 안 된다.
  assert.deepEqual(Object.keys(PAPERS_GROUP_CLASSES), ["경찰", "소방", "계리직"]);
  assert.equal(papersGroupColor("경찰"), "bg-sky-700 text-white");
  assert.notEqual(papersGroupColor("경찰"), examTypeFilledColor("경찰"));
  assert.equal(papersGroupColor("9급"), undefined);
});

// 군무원은 맵 셋에 이름이 없어서 회색 폴백(bg-zinc-500)으로 그려졌다 — 카드에 배지가
// 나오긴 하니 "빠졌다"고 보이지도 않았다. 국방색은 팔레트에 없어 hex 를 직접 쓰므로,
// 오타 한 글자면 조용히 다시 폴백으로 떨어진다. 세 맵의 값을 그대로 못 박아 둔다.
test("군무원은 국방색 hex 를 쓰고, 회색 폴백으로 떨어지지 않는다", () => {
  assert.equal(examTypeColor("군무원"), "border border-[#b3c084] text-[#4a5525]");
  assert.equal(examTypeTabColor("군무원"), "border border-[#b3c084] bg-[#f4f6ec] text-[#4a5525]");
  assert.equal(examTypeFilledColor("군무원"), "bg-[#5f6d31] text-white");
  assert.notEqual(examTypeFilledColor("군무원"), examTypeFilledColor("없는시행처"));
});

test("모르는 시험 유형은 zinc 폴백으로 떨어진다", () => {
  assert.equal(examTypeColor("없음"), "border border-zinc-300 text-zinc-700");
  assert.equal(examTypeTabColor("없음"), "border border-zinc-400 bg-zinc-100 text-zinc-700");
  assert.equal(examTypeFilledColor("없음"), "bg-zinc-500 text-white");
});

test("과목 팔레트는 core 의 슬롯 수와 같고 같은 slug 는 항상 같은 색이다", () => {
  assert.equal(SUBJECT_PALETTE_CLASSES.length, SUBJECT_PALETTE_SIZE);
  assert.equal(subjectColor("korean"), subjectColor("korean"));
  assert.ok(SUBJECT_PALETTE_CLASSES.includes(subjectColor("english")));
});

test("회독·스트릭 등급 배지는 tiers.ts 의 경계값을 그대로 따른다", () => {
  assert.equal(getRoundTier(0).name, "브론즈");
  assert.equal(getRoundTier(10).name, "다이아");
  assert.equal(getRoundTier(10).hasGlow, true);
  assert.equal(getRoundTier(2).name, "실버");
  assert.equal(streakTier(0), null);
  assert.deepEqual(streakTier(30), { label: "다이아", className: "bg-cyan-100 text-cyan-700" });
  assert.equal(streakTier(1)?.label, "새싹");
});
