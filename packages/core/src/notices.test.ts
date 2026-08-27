import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTICE_CONTENT_MAX, NOTICE_TITLE_MAX, validateNoticeInput } from "./notices";

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
