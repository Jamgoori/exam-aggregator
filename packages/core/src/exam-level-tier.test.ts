import { test } from "node:test";
import assert from "node:assert/strict";
import { examLevelTier, isApproxLevelTier } from "./exam-level-tier";

// 여기가 틀리면 9급 준비생 세션에 7급·승진시험 문항이 조용히 섞인다. 증상이 "요즘
// 섞어풀기가 어렵다" 정도로만 오므로 규칙을 테스트로 못 박아 둔다.

test("급수가 적혀 있으면 그대로 등급이다", () => {
  assert.equal(examLevelTier({ level: "9급", examTypeName: "국가직" }), "9급");
  assert.equal(examLevelTier({ level: "7급", examTypeName: "지방직" }), "7급");
  assert.equal(examLevelTier({ level: "8급", examTypeName: "국회직" }), "8급");
  // 급수가 있으면 "수준"이 아니라 사실이다.
  assert.equal(isApproxLevelTier({ level: "9급", examTypeName: "국가직" }), false);
});

test("급수 없는 채용(순경·소방사·해경·계리직)은 9급 수준으로 묶인다", () => {
  for (const type of ["경찰", "소방", "해경", "계리직"]) {
    assert.equal(examLevelTier({ level: null, examTypeName: type }), "9급", type);
    assert.equal(isApproxLevelTier({ level: null, examTypeName: type }), true, type);
  }
});

test("간부후보생은 7급 수준 — 공채와 같은 칸에 넣지 않는다", () => {
  assert.equal(
    examLevelTier({ level: null, examTypeName: "소방", track: "간부후보" }),
    "7급",
  );
  assert.equal(
    examLevelTier({ level: null, examTypeName: "경찰", track: "간부후보생" }),
    "7급",
  );
});

test("승진시험은 어느 급수에도 묶지 않는다", () => {
  assert.equal(
    examLevelTier({ level: null, examTypeName: "소방", track: "소방위 승진" }),
    null,
  );
  assert.equal(
    isApproxLevelTier({ level: null, examTypeName: "소방", track: "소방위 승진" }),
    false,
  );
});

test("모르는 시행처는 묶지 않는다 — 틀린 등급보다 '기타'가 낫다", () => {
  assert.equal(examLevelTier({ level: null, examTypeName: "처음보는직렬" }), null);
  assert.equal(examLevelTier({ level: null, examTypeName: null }), null);
  assert.equal(examLevelTier({ level: "", examTypeName: "" }), null);
  // 급수 없는 시행처가 아닌 곳의 간부후보 표기도 마찬가지.
  assert.equal(
    examLevelTier({ level: null, examTypeName: "국가직", track: "간부후보" }),
    null,
  );
});
