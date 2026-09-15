import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCbtViewMode, resolveInitialCbtViewMode } from "./cbt-view-mode";

describe("resolveInitialCbtViewMode", () => {
  it("문항 이미지가 없으면 무조건 전체보기", () => {
    assert.equal(resolveInitialCbtViewMode(null, false), "full");
    assert.equal(resolveInitialCbtViewMode("single", false), "full");
  });

  it("잠금값이 full 일 때만 전체보기, 그 외(null·single)는 문제별(사이트 기본)", () => {
    assert.equal(resolveInitialCbtViewMode("full", true), "full");
    assert.equal(resolveInitialCbtViewMode("single", true), "single");
    assert.equal(resolveInitialCbtViewMode(null, true), "single");
  });
});

describe("parseCbtViewMode", () => {
  it("full·single 만 인정하고 나머지는 null", () => {
    assert.equal(parseCbtViewMode("full"), "full");
    assert.equal(parseCbtViewMode("single"), "single");
    assert.equal(parseCbtViewMode("FULL"), null);
    assert.equal(parseCbtViewMode(undefined), null);
    assert.equal(parseCbtViewMode(1), null);
  });
});
