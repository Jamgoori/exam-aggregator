import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupQuestionsBySharedImages,
  groupRowsBySharedImages,
  haveSameImages,
} from "./question-groups";

describe("haveSameImages", () => {
  it("빈 배열끼리는 같은 세트가 아니다(크롭 전 문제지가 통째로 묶이지 않게)", () => {
    assert.equal(haveSameImages([], []), false);
  });

  it("원소 순서까지 같아야 같다", () => {
    assert.equal(haveSameImages(["a", "b"], ["a", "b"]), true);
    assert.equal(haveSameImages(["a", "b"], ["b", "a"]), false);
    assert.equal(haveSameImages(["a"], ["a", "b"]), false);
  });
});

describe("groupQuestionsBySharedImages", () => {
  it("연속 번호의 이미지 배열이 완전히 같으면 같은 세트로 묶는다", () => {
    const groups = groupQuestionsBySharedImages(5, {
      1: ["q1"],
      2: ["set-a", "set-b"],
      3: ["set-a", "set-b"],
      4: ["q4"],
      5: ["set-a", "set-b"],
    });
    assert.deepEqual(groups.get(1), [1]);
    assert.deepEqual(groups.get(2), [2, 3]);
    assert.deepEqual(groups.get(3), [2, 3]);
    assert.deepEqual(groups.get(4), [4]);
    // 5번은 2·3번과 이미지가 같아도 연속이 아니라 별개.
    assert.deepEqual(groups.get(5), [5]);
    // 같은 세트는 같은 배열 참조를 공유한다(웹 questionGroups 와 동일).
    assert.equal(groups.get(2), groups.get(3));
  });

  it("이미지가 없는 번호는 각각 [n] 이고 전 번호가 키로 들어간다", () => {
    const groups = groupQuestionsBySharedImages(3, {});
    assert.equal(groups.size, 3);
    assert.deepEqual([...groups.keys()], [1, 2, 3]);
    assert.deepEqual(groups.get(2), [2]);
  });

  it("totalQuestions 가 0 이면 빈 맵", () => {
    assert.equal(groupQuestionsBySharedImages(0, { 1: ["x"] }).size, 0);
  });
});

describe("groupRowsBySharedImages", () => {
  it("앞 행과 이미지가 같은 행을 한 카드로 합친다", () => {
    const rows = [
      { n: 1, images: ["a"] },
      { n: 2, images: ["s1", "s2"] },
      { n: 3, images: ["s1", "s2"] },
      { n: 4, images: [] },
      { n: 5, images: [] },
    ];
    const groups = groupRowsBySharedImages(rows);
    assert.deepEqual(
      groups.map((g) => g.rows.map((r) => r.n)),
      [[1], [2, 3], [4], [5]],
    );
    assert.deepEqual(groups[1].images, ["s1", "s2"]);
  });

  it("빈 입력이면 빈 배열", () => {
    assert.deepEqual(groupRowsBySharedImages([]), []);
  });
});
