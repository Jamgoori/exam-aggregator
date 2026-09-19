import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterBlocked,
  isReportReason,
  isReportTargetType,
  reportReasonLabel,
  reportTargetLabel,
  validateReportInput,
  REPORT_DETAIL_MAX,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
} from "./ugc";

test("신고 대상은 세 종류고 slug 는 content_reports.target_type 값과 같다", () => {
  // schema.sql 의 content_reports_target_type_check 와 같은 목록 — 한쪽만 고치면 RPC 가 거절한다.
  assert.deepEqual(
    REPORT_TARGET_TYPES.map((t) => t.slug),
    ["board_post", "suggestion", "chat_message"],
  );
  assert.equal(isReportTargetType("chat_message"), true);
  assert.equal(isReportTargetType("comment"), false);
  assert.equal(reportTargetLabel("suggestion"), "건의글");
  assert.equal(reportTargetLabel("unknown"), "게시글");
});

test("차단 필터는 탈퇴한 회원의 글(authorId null)을 남긴다", () => {
  const items = [{ authorId: null }, { authorId: "u1" }, { authorId: "u2" }];
  assert.deepEqual(filterBlocked(items, ["u1"]), [{ authorId: null }, { authorId: "u2" }]);
});

test("신고 사유는 다섯 가지고 slug 가 겹치지 않는다", () => {
  // schema.sql 의 board_post_reports_reason_check 와 같은 목록 — 한쪽만 고치면 화면에서 고른
  // 사유가 DB 에서 거절된다.
  assert.deepEqual(
    REPORT_REASONS.map((r) => r.slug),
    ["spam", "abuse", "sexual", "privacy", "other"],
  );
  assert.equal(new Set(REPORT_REASONS.map((r) => r.slug)).size, REPORT_REASONS.length);
  assert.equal(isReportReason("spam"), true);
  assert.equal(isReportReason("hate"), false);
  assert.equal(reportReasonLabel("privacy"), "개인정보 노출");
  assert.equal(reportReasonLabel("unknown"), "기타");
});

test("신고 폼 검증 — 사유·상세 길이·기타는 내용 필수", () => {
  assert.deepEqual(validateReportInput({ reason: "spam" }), { reason: "spam", detail: null });
  assert.deepEqual(validateReportInput({ reason: "abuse", detail: "  욕설  " }), {
    reason: "abuse",
    detail: "욕설",
  });
  assert.deepEqual(validateReportInput({ reason: "x" }), { error: "신고 사유를 선택해주세요." });
  assert.deepEqual(validateReportInput({ reason: "other", detail: "" }), {
    error: "기타 사유는 내용을 적어주세요.",
  });
  assert.deepEqual(validateReportInput({ reason: "spam", detail: "가".repeat(REPORT_DETAIL_MAX + 1) }), {
    error: `상세 설명은 ${REPORT_DETAIL_MAX}자 이하로 입력해주세요.`,
  });
});

test("차단 목록으로 작성자를 거른다 — 빈 목록이면 그대로", () => {
  const items = [
    { id: "1", authorId: "a" },
    { id: "2", authorId: "b" },
    { id: "3", authorId: "a" },
  ];
  assert.deepEqual(filterBlocked(items, new Set(["a"])).map((i) => i.id), ["2"]);
  assert.deepEqual(filterBlocked(items, ["b"]).map((i) => i.id), ["1", "3"]);
  assert.deepEqual(filterBlocked(items, []).map((i) => i.id), ["1", "2", "3"]);
});
