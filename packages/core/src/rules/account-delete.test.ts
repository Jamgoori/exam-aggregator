import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient, type Row } from "../test-support/fake-supabase";
import {
  ANONYMIZED_NICKNAME,
  DELETED_CHAT_TEXT,
  DELETED_POST_TEXT,
  DELETED_POST_TITLE,
  deleteAccount,
  deletedPostHtml,
} from "./account-delete";
import { sanitizeRichText } from "../rich-text";

// 회원 탈퇴 규칙(설계서 §12-2 #17). Edge `account-delete` 가 이 함수를 부른다(웹도 같은 EF). 보는 것:
//   1. 순서 — 댓글 익명화 → 원글 비우기 → FK 끊기 → 스토리지 → deleteUser.
//   2. 내용 — 댓글은 내용 유지·닉네임만, 원글은 제목·본문·썸네일까지 비움, 비밀글 여부 유지.
//      남의 행은 건드리지 않는다.
//   3. null 처리 — user_id 가 null 로 끊긴다(FK set null 과 같은 최종 상태).
//   4. 실패 — FK 를 끊지 못하면 deleteUser 를 부르지 않고 오류. 스토리지 실패는 로그만 남기고 진행.
//      deleteUser 실패는 오류(정리는 이미 끝난 상태 — 다시 누르면 된다).

const U = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
const ME = U("a");
const OTHER = U("b");

function db(overrides: Record<string, Row[]> = {}) {
  return new FakeSupabase({
    comments: [
      { id: "c1", user_id: ME, nickname: "나", content: "내 댓글" },
      { id: "c2", user_id: OTHER, nickname: "남", content: "남 댓글" },
    ],
    board_comments: [{ id: "bc1", user_id: ME, nickname: "나", content: "내 게시판 댓글", parent_id: null }],
    suggestion_comments: [{ id: "sc1", user_id: ME, nickname: "나", content: "내 건의 댓글" }],
    notice_comments: [{ id: "nc1", user_id: ME, nickname: "나", content: "내 공지 댓글" }],
    board_posts: [
      { id: "p1", user_id: ME, nickname: "나", title: "내 글", content_html: "<p>본문</p><img src=\"x\">", content_text: "본문", thumbnail_url: "x" },
      { id: "p2", user_id: OTHER, nickname: "남", title: "남 글", content_html: "<p>남</p>", content_text: "남", thumbnail_url: null },
    ],
    suggestions: [
      { id: "s1", user_id: ME, nickname: "나", title: "내 건의", content: "내용", is_secret: true, answered_by: null },
      { id: "s2", user_id: OTHER, nickname: "남", title: "남 건의", content: "내용", is_secret: false, answered_by: ME },
    ],
    chat_messages: [{ id: "m1", user_id: ME, nickname: "나", content: "내 말" }],
    exam_papers: [{ id: "e1", uploaded_by: ME }],
    answer_keys: [],
    law_digests: [],
    notices: [{ id: "n1", created_by: ME }],
    users: [{ id: ME, user_metadata: {} }],
    ...overrides,
  });
}

function logs() {
  const out: string[] = [];
  return { out, log: (m: string) => out.push(m) };
}

test("본문 상수: content_html 은 새니타이저 고정점이다", () => {
  const html = deletedPostHtml();
  assert.equal(html, `<p>${DELETED_POST_TEXT}</p>`);
  assert.equal(sanitizeRichText(html, { imageOrigins: [] }), html);
  // *_nickname_len(1~10)·title(1~100) 제약 안.
  assert.ok(ANONYMIZED_NICKNAME.length >= 1 && ANONYMIZED_NICKNAME.length <= 10);
  assert.ok(DELETED_POST_TITLE.length >= 1 && DELETED_POST_TITLE.length <= 100);
});

test("순서: 댓글류 → 원글류 → FK 끊기 → 스토리지 → deleteUser", async () => {
  const fake = db();
  fake.objects["avatars"] = [{ path: `${ME}/a.webp`, created_at: "2026-09-01T00:00:00.000Z" }];
  fake.objects["board-images"] = [
    { path: `${ME}/1.webp`, created_at: "2026-09-01T00:00:00.000Z" },
    { path: `${OTHER}/2.webp`, created_at: "2026-09-01T00:00:00.000Z" },
  ];
  const { log } = logs();
  const r = await deleteAccount(asClient(fake), { userId: ME }, { log });
  assert.deepEqual(r, { ok: true });

  assert.deepEqual(
    fake.writes.map((w) => w.table),
    [
      "comments",
      "board_comments",
      "suggestion_comments",
      "notice_comments",
      "board_posts",
      "suggestions",
      "chat_messages",
      "exam_papers",
      "answer_keys",
      "law_digests",
      "suggestions",
      "notices",
    ],
  );
  // 스토리지는 두 버킷의 내 디렉터리만, deleteUser 는 마지막.
  assert.deepEqual(fake.removes, [
    { bucket: "avatars", paths: [`${ME}/a.webp`] },
    { bucket: "board-images", paths: [`${ME}/1.webp`] },
  ]);
  assert.deepEqual(fake.deletedUsers, [ME]);
});

test("내용: 댓글은 내용 유지·닉네임만, 원글은 비움, 남의 행은 그대로", async () => {
  const fake = db();
  await deleteAccount(asClient(fake), { userId: ME }, logs());

  const mine = fake.rowsOf("comments").find((r) => r.id === "c1")!;
  assert.equal(mine.user_id, null);
  assert.equal(mine.nickname, ANONYMIZED_NICKNAME);
  assert.equal(mine.content, "내 댓글");
  const theirs = fake.rowsOf("comments").find((r) => r.id === "c2")!;
  assert.equal(theirs.user_id, OTHER);
  assert.equal(theirs.nickname, "남");

  for (const table of ["board_comments", "suggestion_comments", "notice_comments"]) {
    const row = fake.rowsOf(table)[0];
    assert.equal(row.user_id, null, table);
    assert.equal(row.nickname, ANONYMIZED_NICKNAME, table);
    assert.match(String(row.content), /^내 /, table);
  }

  const post = fake.rowsOf("board_posts").find((r) => r.id === "p1")!;
  assert.equal(post.user_id, null);
  assert.equal(post.nickname, ANONYMIZED_NICKNAME);
  assert.equal(post.title, DELETED_POST_TITLE);
  assert.equal(post.content_html, `<p>${DELETED_POST_TEXT}</p>`);
  assert.equal(post.content_text, DELETED_POST_TEXT);
  assert.equal(post.thumbnail_url, null);
  const otherPost = fake.rowsOf("board_posts").find((r) => r.id === "p2")!;
  assert.equal(otherPost.title, "남 글");

  const sug = fake.rowsOf("suggestions").find((r) => r.id === "s1")!;
  assert.equal(sug.user_id, null);
  assert.equal(sug.title, DELETED_POST_TITLE);
  assert.equal(sug.content, DELETED_POST_TEXT);
  // 비밀글은 비밀글 자리로 남는다.
  assert.equal(sug.is_secret, true);

  const chat = fake.rowsOf("chat_messages")[0];
  assert.equal(chat.user_id, null);
  assert.equal(chat.content, DELETED_CHAT_TEXT);
  assert.equal(chat.nickname, ANONYMIZED_NICKNAME);

  // cascade 없는 참조.
  assert.equal(fake.rowsOf("exam_papers")[0].uploaded_by, null);
  assert.equal(fake.rowsOf("suggestions").find((r) => r.id === "s2")!.answered_by, null);
  assert.equal(fake.rowsOf("notices")[0].created_by, null);
});

test("실패: FK 를 끊지 못하면 deleteUser 를 부르지 않고 오류", async () => {
  const fake = db();
  fake.failNext.set("exam_papers", "boom");
  const { out, log } = logs();
  const r = await deleteAccount(asClient(fake), { userId: ME }, { log });
  assert.deepEqual(r, { error: "계정 정리에 실패했어요. 잠시 후 다시 시도해 주세요.", status: 500 });
  assert.deepEqual(fake.deletedUsers, []);
  assert.deepEqual(fake.removes, []);
  assert.equal(out.length, 1);
});

test("실패: 댓글·원글 정리 실패는 탈퇴를 멈춘다(계정은 그대로 — 다시 누르면 된다)", async () => {
  const fake = db();
  fake.failNext.set("board_posts", "boom");
  const r = await deleteAccount(asClient(fake), { userId: ME }, logs());
  assert.deepEqual(r, { error: "글 정리에 실패했어요. 잠시 후 다시 시도해 주세요.", status: 500 });
  assert.deepEqual(fake.deletedUsers, []);

  const fake2 = db();
  fake2.failNext.set("suggestion_comments", "boom");
  const r2 = await deleteAccount(asClient(fake2), { userId: ME }, logs());
  assert.deepEqual(r2, { error: "댓글 정리에 실패했어요. 잠시 후 다시 시도해 주세요.", status: 500 });
  assert.deepEqual(fake2.deletedUsers, []);
});

test("실패: 스토리지 정리 실패는 로그만 남기고 탈퇴는 진행한다", async () => {
  const fake = db();
  fake.objects["avatars"] = [{ path: `${ME}/a.webp`, created_at: "2026-09-01T00:00:00.000Z" }];
  fake.failNextStorageList = "storage down";
  const { out, log } = logs();
  const r = await deleteAccount(asClient(fake), { userId: ME }, { log });
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(fake.deletedUsers, [ME]);
  assert.ok(out.some((m) => m.includes("avatars 목록 실패")));
});

test("실패: deleteUser 가 실패하면 오류 — 정리는 이미 끝났고 다시 누르면 된다", async () => {
  const fake = db();
  fake.failNextDeleteUser = "auth down";
  const r = await deleteAccount(asClient(fake), { userId: ME }, logs());
  assert.deepEqual(r, { error: "계정 삭제에 실패했어요. 잠시 후 다시 시도해 주세요.", status: 500 });
  assert.equal(fake.rowsOf("board_posts").find((p) => p.id === "p1")!.user_id, null);
});

test("스토리지: 100개를 넘는 게시판 이미지도 빌 때까지 지운다", async () => {
  const fake = db();
  fake.objects["board-images"] = Array.from({ length: 250 }, (_, i) => ({
    path: `${ME}/${i}.webp`,
    created_at: "2026-09-01T00:00:00.000Z",
  }));
  await deleteAccount(asClient(fake), { userId: ME }, logs());
  const removed = fake.removes.filter((r) => r.bucket === "board-images").flatMap((r) => r.paths);
  assert.equal(removed.length, 250);
  assert.equal(fake.objects["board-images"].length, 0);
});
