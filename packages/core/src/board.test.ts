import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardCategoryLabel,
  boardPreviewText,
  canDeleteBoardPost,
  canEditBoardPost,
  canPinBoardPost,
  isBoardCategory,
  resolveBoardCommentParent,
  validateBoardCommentContent,
  validateBoardPostInput,
} from "./board";

const ME = { userId: "u1", isAdmin: false };
const OTHER = { userId: "u2", isAdmin: false };
const ADMIN = { userId: "u9", isAdmin: true };
const GUEST = { userId: null, isAdmin: false };

test("수정은 본인만, 삭제는 본인과 관리자", () => {
  const post = { user_id: "u1" };
  assert.equal(canEditBoardPost(post, ME), true);
  assert.equal(canEditBoardPost(post, OTHER), false);
  // 관리자에게도 수정은 열지 않는다 — 남의 글 내용이 바뀌어 있으면 안 된다.
  assert.equal(canEditBoardPost(post, ADMIN), false);
  assert.equal(canEditBoardPost(post, GUEST), false);

  assert.equal(canDeleteBoardPost(post, ME), true);
  assert.equal(canDeleteBoardPost(post, ADMIN), true);
  assert.equal(canDeleteBoardPost(post, OTHER), false);
});

test("고정(공지)은 관리자만", () => {
  assert.equal(canPinBoardPost(ADMIN), true);
  assert.equal(canPinBoardPost(ME), false);
});

test("말머리 판별", () => {
  assert.equal(isBoardCategory("free"), true);
  assert.equal(isBoardCategory("notice"), false);
  assert.equal(boardCategoryLabel("question"), "질문");
  // 모르는 값이 들어와도 화면이 비지 않게 기본값으로 떨어진다.
  assert.equal(boardCategoryLabel("???"), "자유");
});

test("글 검증: 제목·말머리·본문", () => {
  const ok = validateBoardPostInput({
    title: "  안녕하세요  ",
    category: "free",
    sanitizedHtml: "<p>첫 글입니다</p>",
  });
  assert.deepEqual("error" in ok ? ok : { title: ok.title, text: ok.contentText }, {
    title: "안녕하세요",
    text: "첫 글입니다",
  });

  assert.deepEqual(
    validateBoardPostInput({ title: "", category: "free", sanitizedHtml: "<p>글</p>" }),
    { error: "제목을 입력해주세요." },
  );
  assert.deepEqual(
    validateBoardPostInput({ title: "제목", category: "없는말머리", sanitizedHtml: "<p>글</p>" }),
    { error: "말머리를 선택해주세요." },
  );
  // 서식만 남고 글자가 없는 본문은 "내용 없음"이다.
  assert.deepEqual(
    validateBoardPostInput({ title: "제목", category: "free", sanitizedHtml: "<p><br></p>" }),
    { error: "내용을 입력해주세요." },
  );
});

test("글 검증: 이미지만 있어도 본문으로 인정한다", () => {
  const result = validateBoardPostInput({
    title: "사진",
    category: "free",
    sanitizedHtml: '<img src="https://cdn.example.com/a.webp">',
  });
  assert.ok(!("error" in result));
});

test("댓글 검증", () => {
  assert.deepEqual(validateBoardCommentContent("  좋은 글이네요 "), {
    content: "좋은 글이네요",
  });
  assert.deepEqual(validateBoardCommentContent("   "), {
    error: "댓글 내용을 입력해주세요.",
  });
  assert.ok("error" in validateBoardCommentContent("가".repeat(1001)));
});

test("미리보기는 줄바꿈을 눌러 한 줄로 만든다", () => {
  assert.equal(boardPreviewText("첫줄\n둘째줄"), "첫줄 둘째줄");
  assert.equal(boardPreviewText("가".repeat(200)).endsWith("…"), true);
});

test("답글의 답글은 원 댓글에 붙는다(깊이 1단계)", () => {
  assert.equal(resolveBoardCommentParent({ id: "c1", parent_id: null }), "c1");
  assert.equal(resolveBoardCommentParent({ id: "c2", parent_id: "c1" }), "c1");
});
