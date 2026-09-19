import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient, type Row } from "../test-support/fake-supabase";
import { createNoticeComment, deleteNoticeComment, updateNoticeComment, type NoticeActor } from "./notices";
import { HOURLY_LIMIT_ERROR, NOTICE_COMMENT_HOURLY_LIMIT } from "./hourly-limit";

// 공지 댓글 규칙. 웹(세션 클라이언트 + RLS)과 Edge(admin 클라이언트)가 같은 함수를 부르므로
// **본문의 소유자 조건**이 RLS 없이도 남의 댓글을 막는지가 이 테스트의 핵심이다.

const U = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
const ME = U("a");
const OTHER = U("b");
const ADMIN = U("c");
const NOTICE = U("1");
const COMMENT = U("2");

const NOW = new Date("2026-09-19T03:00:00.000Z");
const deps = { now: () => NOW };

const me: NoticeActor = { userId: ME, isAdmin: false, metadataNickname: "나" };
const other: NoticeActor = { userId: OTHER, isAdmin: false, metadataNickname: "남" };
const admin: NoticeActor = { userId: ADMIN, isAdmin: true };

function db(comments: Row[] = []) {
  return new FakeSupabase(
    { notice_comments: comments, users: [{ id: ME, user_metadata: { nickname: "메타닉" } }] },
    { primaryKeys: { notice_comments: ["id"] } },
  );
}

test("댓글 작성: 닉네임은 세션 값, 없으면 admin API 로 읽는다", async () => {
  const fake = db();
  assert.deepEqual(
    await createNoticeComment(asClient(fake), { actor: me, noticeId: NOTICE, content: " 댓글 " }, deps),
    { id: NOTICE },
  );
  assert.equal(fake.rowsOf("notice_comments")[0].nickname, "나");
  assert.equal(fake.rowsOf("notice_comments")[0].content, "댓글");

  await createNoticeComment(
    asClient(fake),
    { actor: { userId: ME, isAdmin: false }, noticeId: NOTICE, content: "둘" },
    deps,
  );
  assert.equal(fake.rowsOf("notice_comments")[1].nickname, "메타닉");
});

test("댓글 작성: 검증 문구는 웹과 같고, 시간당 30건이면 429", async () => {
  const fake = db(
    Array.from({ length: NOTICE_COMMENT_HOURLY_LIMIT }, (_, i) => ({
      id: `${U("9")}${i}`,
      notice_id: NOTICE,
      user_id: ME,
      created_at: new Date(NOW.getTime() - 60 * 1000 * (i + 1)).toISOString(),
    })),
  );
  assert.deepEqual(
    await createNoticeComment(asClient(fake), { actor: me, noticeId: "bad", content: "x" }, deps),
    { error: "잘못된 접근입니다.", status: 400 },
  );
  assert.deepEqual(
    await createNoticeComment(asClient(fake), { actor: me, noticeId: NOTICE, content: "  " }, deps),
    { error: "댓글 내용을 입력해주세요.", status: 400 },
  );
  assert.deepEqual(
    await createNoticeComment(asClient(fake), { actor: me, noticeId: NOTICE, content: "x" }, deps),
    { error: HOURLY_LIMIT_ERROR, status: 429 },
  );
  // 다른 사람의 한도에는 영향이 없다.
  assert.deepEqual(
    await createNoticeComment(asClient(fake), { actor: other, noticeId: NOTICE, content: "x" }, deps),
    { id: NOTICE },
  );
});

test("댓글 수정: 본인만 — 관리자도 남의 댓글은 못 고친다", async () => {
  const fake = db([{ id: COMMENT, notice_id: NOTICE, user_id: ME, content: "원문" }]);
  assert.deepEqual(
    await updateNoticeComment(asClient(fake), { actor: other, commentId: COMMENT, content: "x" }, deps),
    { error: "권한이 없어요.", status: 403 },
  );
  assert.deepEqual(
    await updateNoticeComment(asClient(fake), { actor: admin, commentId: COMMENT, content: "x" }, deps),
    { error: "권한이 없어요.", status: 403 },
  );
  assert.deepEqual(
    await updateNoticeComment(asClient(fake), { actor: me, commentId: COMMENT, content: "고침" }, deps),
    { id: NOTICE },
  );
  assert.equal(fake.rowsOf("notice_comments")[0].content, "고침");
  assert.equal(fake.rowsOf("notice_comments")[0].updated_at, NOW.toISOString());
  assert.deepEqual(
    await updateNoticeComment(asClient(fake), { actor: me, commentId: U("3"), content: "x" }, deps),
    { error: "댓글을 찾을 수 없어요.", status: 404 },
  );
});

test("댓글 삭제: 본인 또는 관리자", async () => {
  const fake = db([
    { id: COMMENT, notice_id: NOTICE, user_id: ME, content: "a" },
    { id: U("3"), notice_id: NOTICE, user_id: OTHER, content: "b" },
  ]);
  assert.deepEqual(await deleteNoticeComment(asClient(fake), { actor: other, commentId: COMMENT }), {
    error: "권한이 없어요.",
    status: 403,
  });
  assert.deepEqual(await deleteNoticeComment(asClient(fake), { actor: me, commentId: COMMENT }), {
    id: NOTICE,
  });
  assert.deepEqual(await deleteNoticeComment(asClient(fake), { actor: admin, commentId: U("3") }), {
    id: NOTICE,
  });
  assert.equal(fake.rowsOf("notice_comments").length, 0);
});
