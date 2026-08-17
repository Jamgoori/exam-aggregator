import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteSuggestion,
  canEditSuggestion,
  canPinSuggestion,
  canReadSuggestion,
  SECRET_TITLE_PLACEHOLDER,
  suggestionListTitle,
  validateSuggestionAnswer,
  validateSuggestionInput,
  SUGGESTION_CONTENT_MAX,
  SUGGESTION_TITLE_MAX,
} from "./suggestions";

// 이 규칙이 무너지면 남의 비밀글이 그대로 새므로, 화면(목록/상세)과 서버 액션이
// 함께 쓰는 판단 함수만 여기서 못박아 둔다.

const author = { userId: "u-author", isAdmin: false };
const stranger = { userId: "u-other", isAdmin: false };
const guest = { userId: null, isAdmin: false };
const admin = { userId: "u-admin", isAdmin: true };

const publicPost = { user_id: "u-author", is_secret: false, title: "검색이 느려요" };
const secretPost = { user_id: "u-author", is_secret: true, title: "결제 오류 문의" };

test("공개글은 비회원도 읽는다", () => {
  assert.equal(canReadSuggestion(publicPost, guest), true);
  assert.equal(canReadSuggestion(publicPost, stranger), true);
});

test("비밀글은 글쓴이와 관리자만 읽는다", () => {
  assert.equal(canReadSuggestion(secretPost, author), true);
  assert.equal(canReadSuggestion(secretPost, admin), true);
  assert.equal(canReadSuggestion(secretPost, stranger), false);
  assert.equal(canReadSuggestion(secretPost, guest), false);
});

test("로그인하지 않은 사람의 userId(null)가 글쓴이로 오인되지 않는다", () => {
  // user_id 가 어떤 이유로든 비어 있어도 null === null 로 통과하면 안 된다.
  const orphan = { user_id: null as unknown as string, is_secret: true };
  assert.equal(canReadSuggestion(orphan, guest), false);
});

test("목록 제목은 볼 수 없는 비밀글일 때만 가려진다", () => {
  assert.equal(suggestionListTitle(secretPost, author), "결제 오류 문의");
  assert.equal(suggestionListTitle(secretPost, admin), "결제 오류 문의");
  assert.equal(suggestionListTitle(secretPost, stranger), SECRET_TITLE_PLACEHOLDER);
  assert.equal(suggestionListTitle(publicPost, stranger), "검색이 느려요");
});

test("수정은 본인만 — 관리자도 남의 건의를 고칠 수 없다", () => {
  assert.equal(canEditSuggestion(publicPost, author), true);
  assert.equal(canEditSuggestion(publicPost, admin), false);
  assert.equal(canEditSuggestion(publicPost, stranger), false);
});

test("삭제는 본인과 관리자", () => {
  assert.equal(canDeleteSuggestion(publicPost, author), true);
  assert.equal(canDeleteSuggestion(publicPost, admin), true);
  assert.equal(canDeleteSuggestion(publicPost, stranger), false);
});

test("제목·내용 검증", () => {
  assert.deepEqual(validateSuggestionInput({ title: "  ", content: "내용" }), {
    error: "제목을 입력해주세요.",
  });
  assert.deepEqual(validateSuggestionInput({ title: "제목", content: "   " }), {
    error: "내용을 입력해주세요.",
  });
  assert.ok(
    "error" in
      validateSuggestionInput({
        title: "가".repeat(SUGGESTION_TITLE_MAX + 1),
        content: "내용",
      }),
  );
  assert.ok(
    "error" in
      validateSuggestionInput({
        title: "제목",
        content: "가".repeat(SUGGESTION_CONTENT_MAX + 1),
      }),
  );
  assert.deepEqual(validateSuggestionInput({ title: " 제목 ", content: " 내용 " }), {
    title: "제목",
    content: "내용",
  });
});

test("공지 고정은 관리자만 켤 수 있다", () => {
  assert.equal(canPinSuggestion(admin), true);
  assert.equal(canPinSuggestion(author), false);
  assert.equal(canPinSuggestion(stranger), false);
  assert.equal(canPinSuggestion(guest), false);
});

test("빈 답변은 거절한다 (답변 완료 배지만 붙는 글 방지)", () => {
  assert.ok("error" in validateSuggestionAnswer("   "));
  assert.deepEqual(validateSuggestionAnswer(" 확인 후 반영했습니다. "), {
    answer: "확인 후 반영했습니다.",
  });
});
