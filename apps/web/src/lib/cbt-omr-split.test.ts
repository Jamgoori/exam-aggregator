import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampOmrSplit,
  DEFAULT_OMR_SPLIT,
  MAX_OMR_SPLIT,
  MIN_OMR_SPLIT,
} from "./cbt-omr-split";

test("범위 안의 비율은 그대로 둔다", () => {
  assert.equal(clampOmrSplit(0.5), 0.5);
});

test("범위를 벗어난 비율은 최소/최대로 잘라낸다", () => {
  assert.equal(clampOmrSplit(0.01), MIN_OMR_SPLIT);
  assert.equal(clampOmrSplit(0.99), MAX_OMR_SPLIT);
});

test("숫자가 아닌 저장값은 기본값으로 되돌린다", () => {
  assert.equal(clampOmrSplit(Number.NaN), DEFAULT_OMR_SPLIT);
});
