import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCommentTree, canReplyTo, COMMENT_MAX_DEPTH } from "./comments";
import type { Comment } from "./types";

// 깊이 한도는 서버(웹 papers/actions.ts, 앱 comments-write)도 같은 값으로 검사한다.
// 트리를 그리는 쪽과 거절하는 쪽이 어긋나면 "답글 버튼은 보이는데 누르면 거절"이 된다.

function comment(id: string, parentId: string | null = null, createdAt = "2026-07-01T00:00:00Z"): Comment {
  return {
    id,
    paper_id: "p1",
    user_id: "u1",
    nickname: "회원",
    content: `${id} 내용`,
    parent_id: parentId,
    created_at: createdAt,
    updated_at: null,
  } as Comment;
}

test("부모-자식 관계로 트리를 만든다", () => {
  const tree = buildCommentTree([comment("a"), comment("b", "a"), comment("c", "b")]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].replies[0].id, "b");
  assert.equal(tree[0].replies[0].replies[0].id, "c");
});

test("깊이는 1부터 센다 (원댓글 1, 대댓글 2, 대대댓글 3)", () => {
  const tree = buildCommentTree([comment("a"), comment("b", "a"), comment("c", "b")]);
  assert.equal(tree[0].depth, 1);
  assert.equal(tree[0].replies[0].depth, 2);
  assert.equal(tree[0].replies[0].replies[0].depth, 3);
});

test("깊이 한도는 3 — 서버 검증(웹 actions.ts, comments-write)이 쓰는 값과 같아야 한다", () => {
  // 상수 자체를 비교하지 않고 리터럴로 고정한다. 여기서 상수를 그대로 쓰면 한도를 바꿔도
  // 테스트가 통과해버려(동어반복) 서버와 어긋난 걸 못 잡는다.
  assert.equal(COMMENT_MAX_DEPTH, 3);
});

test("대대댓글까지만 답글을 허용한다", () => {
  assert.equal(canReplyTo(1), true);
  assert.equal(canReplyTo(2), true);
  assert.equal(canReplyTo(3), false);
  assert.equal(canReplyTo(4), false);
});

test("부모가 목록에 없는 댓글은 유실되지 않고 최상위로 올라온다", () => {
  const tree = buildCommentTree([comment("orphan", "사라진부모")]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, "orphan");
  assert.equal(tree[0].depth, 1);
});

test("형제는 작성 순으로 정렬한다", () => {
  const tree = buildCommentTree([
    comment("late", null, "2026-07-03T00:00:00Z"),
    comment("early", null, "2026-07-01T00:00:00Z"),
    comment("mid", null, "2026-07-02T00:00:00Z"),
  ]);
  assert.deepEqual(
    tree.map((c) => c.id),
    ["early", "mid", "late"],
  );
});

test("답글끼리도 작성 순으로 정렬한다", () => {
  const tree = buildCommentTree([
    comment("root"),
    comment("r2", "root", "2026-07-05T00:00:00Z"),
    comment("r1", "root", "2026-07-04T00:00:00Z"),
  ]);
  assert.deepEqual(
    tree[0].replies.map((c) => c.id),
    ["r1", "r2"],
  );
});

test("데이터가 깨져 순환이 생겨도 멈추지 않는다", () => {
  // a → b → a. 어느 쪽도 최상위가 아니라 트리에 안 잡히지만, 무한 루프에 빠지면 안 된다.
  const tree = buildCommentTree([comment("a", "b"), comment("b", "a")]);
  assert.deepEqual(tree, []);
});

test("원본 배열을 건드리지 않는다", () => {
  const input = [comment("a"), comment("b", "a")];
  const snapshot = JSON.parse(JSON.stringify(input));
  buildCommentTree(input);
  assert.deepEqual(JSON.parse(JSON.stringify(input)), snapshot);
});

test("빈 입력에도 안전하다", () => {
  assert.deepEqual(buildCommentTree([]), []);
});
