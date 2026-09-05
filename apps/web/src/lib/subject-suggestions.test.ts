import { test } from "node:test";
import assert from "node:assert/strict";
import { getSubjectSuggestions } from "./subject-suggestions";

const SUBJECTS = [
  { slug: "korean", name: "국어" },
  { slug: "admin-law", name: "행정법총론" },
  { slug: "admin-study", name: "행정학개론" },
  { slug: "chinese", name: "중국어" },
];
const EXAM_TYPES = ["국가직", "지방직"];

test("검색어가 비면 아무것도 추천하지 않는다", () => {
  assert.deepEqual(getSubjectSuggestions(SUBJECTS, "  ", EXAM_TYPES), []);
});

test("연도·급수·시행처가 섞여 있어도 과목명만 보고 매칭한다", () => {
  assert.deepEqual(
    getSubjectSuggestions(SUBJECTS, "2025 국가직 9급 국어", EXAM_TYPES),
    [{ slug: "korean", name: "국어" }],
  );
});

test("접두 매칭이 있으면 단어 중간에 걸리는 과목은 빼고 준다", () => {
  assert.deepEqual(getSubjectSuggestions(SUBJECTS, "국어", EXAM_TYPES), [
    { slug: "korean", name: "국어" },
  ]);
});

test("보여주는 이름은 방금 친 검색어에 맞춘다(주소는 그 과목 그대로)", () => {
  assert.deepEqual(getSubjectSuggestions(SUBJECTS, "행정법", EXAM_TYPES), [
    { slug: "admin-law", name: "행정법" },
  ]);
});

test("초성으로도 찾을 수 있다(초성은 이름 어디에 있어도 걸린다)", () => {
  assert.deepEqual(getSubjectSuggestions(SUBJECTS, "ㄱㅇ", EXAM_TYPES), [
    { slug: "korean", name: "국어" },
    { slug: "chinese", name: "중국어" },
  ]);
});

test("추천은 6개까지만", () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    slug: `s${i}`,
    name: `행정법${i}`,
  }));
  assert.equal(getSubjectSuggestions(many, "행정법", EXAM_TYPES).length, 6);
});
