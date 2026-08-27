import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteNoticeComment,
  canEditNoticeComment,
  NOTICE_COMMENT_MAX,
  NOTICE_CONTENT_MAX,
  NOTICE_TITLE_MAX,
  validateNoticeCommentContent,
  validateNoticeInput,
} from "./notices";

test("제목·내용이 비어있으면 에러", () => {
  assert.deepEqual(validateNoticeInput({ title: "", content: "본문" }), {
    error: "제목을 입력해주세요.",
  });
  assert.deepEqual(validateNoticeInput({ title: "제목", content: "" }), {
    error: "내용을 입력해주세요.",
  });
});

test("길이 제한을 넘으면 에러", () => {
  const longTitle = "a".repeat(NOTICE_TITLE_MAX + 1);
  const longContent = "a".repeat(NOTICE_CONTENT_MAX + 1);
  assert.equal(
    "error" in validateNoticeInput({ title: longTitle, content: "본문" }),
    true,
  );
  assert.equal(
    "error" in validateNoticeInput({ title: "제목", content: longContent }),
    true,
  );
});

test("앞뒤 공백을 지운 값을 돌려준다", () => {
  const result = validateNoticeInput({ title: "  제목  ", content: "  내용  " });
  assert.deepEqual(result, { title: "제목", content: "내용" });
});

const author = { userId: "u-author", isAdmin: false };
const stranger = { userId: "u-other", isAdmin: false };
const admin = { userId: "u-admin", isAdmin: true };
const guest = { userId: null, isAdmin: false };
const comment = { user_id: "u-author" };

test("댓글 수정은 작성자 본인만 가능 — 관리자에게도 열지 않는다", () => {
  assert.equal(canEditNoticeComment(comment, author), true);
  assert.equal(canEditNoticeComment(comment, stranger), false);
  assert.equal(canEditNoticeComment(comment, admin), false);
  assert.equal(canEditNoticeComment(comment, guest), false);
});

test("댓글 삭제는 작성자 본인 또는 관리자", () => {
  assert.equal(canDeleteNoticeComment(comment, author), true);
  assert.equal(canDeleteNoticeComment(comment, admin), true);
  assert.equal(canDeleteNoticeComment(comment, stranger), false);
});

test("댓글 내용 검증", () => {
  assert.deepEqual(validateNoticeCommentContent("  좋은 정보 감사합니다  "), {
    content: "좋은 정보 감사합니다",
  });
  assert.deepEqual(validateNoticeCommentContent(""), {
    error: "댓글 내용을 입력해주세요.",
  });
  assert.equal(
    "error" in validateNoticeCommentContent("a".repeat(NOTICE_COMMENT_MAX + 1)),
    true,
  );
});
