import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient, type Row } from "../test-support/fake-supabase";
import {
  createBoardComment,
  createBoardPost,
  deleteBoardComment,
  deleteBoardPost,
  updateBoardComment,
  updateBoardPost,
  uploadBoardImage,
  type BoardActor,
} from "./board";
import { BOARD_HOURLY_COMMENT_LIMIT, BOARD_HOURLY_IMAGE_LIMIT, BOARD_HOURLY_POST_LIMIT, HOURLY_LIMIT_ERROR } from "./hourly-limit";
import { BOARD_IMAGE_MAX_WIDTH } from "../board-image";

// 자유게시판 쓰기 규칙(설계서 §6.7 #17). 웹 서버 액션과 Edge `board-write` 가 **이 함수**를
// 부르므로, 여기서 지키는 것이 곧 두 경로가 같다는 뜻이다. 보는 것:
//   1. 순서 — 새니타이즈 → 검증 → 저장. 저장된 HTML 에 <script> 가 없고, 검증이 새니타이즈된
//      결과에 대고 이뤄진다(원본에는 있고 결과에는 없는 본문은 "내용을 입력해주세요").
//   2. is_pinned 는 관리자만 — 비관리자가 보낸 값은 조용히 무시.
//   3. 답글 접기 — 답글의 답글은 원 댓글에 붙는다. 다른 글의 댓글 id 는 부모로 거절.
//   4. 소프트 삭제 — 답글이 달린 댓글은 행을 지우지 않고 is_deleted 표시만 남긴다.
//   5. 시간당 한도 — 10/30/60.
//   6. 알림 — 글쓴이·원 댓글 작성자에게, 본인 제외.
//   7. 이미지 — 검사 실패 시 버킷을 건드리지 않는다.

const U = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
const AUTHOR = U("a");
const OTHER = U("b");
const ADMIN = U("c");
const POST = U("1");
const POST2 = U("2");
const ROOT_COMMENT = U("3");
const REPLY = U("4");

const NOW = new Date("2026-09-19T03:00:00.000Z");
const deps = {
  imageOrigin: "https://p.supabase.co/storage/v1/object/public/board-images/",
  now: () => NOW,
  randomUuid: () => "img-uuid",
};

const author: BoardActor = { userId: AUTHOR, isAdmin: false, metadataNickname: "글쓴이" };
const other: BoardActor = { userId: OTHER, isAdmin: false, metadataNickname: "댓글러" };
const admin: BoardActor = { userId: ADMIN, isAdmin: true, metadataNickname: "운영자" };

function db(tables: Record<string, Row[]> = {}) {
  return new FakeSupabase(
    {
      board_posts: [],
      board_comments: [],
      notifications: [],
      users: [{ id: AUTHOR, user_metadata: { nickname: "글쓴이" } }],
      ...tables,
    },
    { primaryKeys: { board_posts: ["id"], board_comments: ["id"] } },
  );
}

function post(overrides: Row = {}): Row {
  return { id: POST, user_id: AUTHOR, title: "원글", is_pinned: false, ...overrides };
}

// 한 시간 안에 n 건을 쓴 것으로 보이게 하는 행들.
function recentRows(table: string, userId: string, n: number, extra: Row = {}): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: U(String((i % 9) + 1)) + i,
    user_id: userId,
    created_at: new Date(NOW.getTime() - 60 * 1000 * (i + 1)).toISOString(),
    ...extra,
  }));
}

// ── 글 ──────────────────────────────────────────────────────────────────────

test("글 작성: 새니타이즈 → 검증 → 저장 — 스크립트는 저장되지 않고 평문·썸네일이 함께 들어간다", async () => {
  const fake = db();
  const img = `${deps.imageOrigin}${AUTHOR}/x.webp`;
  const result = await createBoardPost(
    asClient(fake),
    {
      actor: author,
      title: "  제목  ",
      category: "free",
      contentHtml: `<p>안녕<script>alert(1)</script></p><img src="${img}"><img src="https://evil.example/t.gif">`,
    },
    deps,
  );
  assert.ok("id" in result, JSON.stringify(result));

  const row = fake.rowsOf("board_posts")[0];
  assert.equal(row.title, "제목");
  assert.equal(row.nickname, "글쓴이");
  assert.doesNotMatch(String(row.content_html), /<script|evil\.example/);
  assert.match(String(row.content_html), /x\.webp/);
  assert.equal(row.content_text, "안녕");
  assert.equal(row.thumbnail_url, img);
  assert.equal(row.is_pinned, false);
});

test("글 작성: 검증은 새니타이즈된 결과에 대고 한다 — 태그만 남는 본문은 내용 없음", async () => {
  const fake = db();
  const result = await createBoardPost(
    asClient(fake),
    { actor: author, title: "제목", category: "free", contentHtml: "<script>alert(1)</script>" },
    deps,
  );
  assert.deepEqual(result, { error: "내용을 입력해주세요.", status: 400 });
  assert.deepEqual(fake.writes, []);
});

test("글 작성: 관리자가 아니면 isPinned 는 무시된다, 관리자는 반영된다", async () => {
  const fake = db();
  await createBoardPost(
    asClient(fake),
    { actor: author, title: "제목", category: "free", contentHtml: "<p>본문</p>", isPinned: true },
    deps,
  );
  assert.equal(fake.rowsOf("board_posts")[0].is_pinned, false);

  await createBoardPost(
    asClient(fake),
    { actor: admin, title: "공지", category: "info", contentHtml: "<p>본문</p>", isPinned: true },
    deps,
  );
  assert.equal(fake.rowsOf("board_posts")[1].is_pinned, true);
});

test("글 작성: 시간당 10건이면 거절(429)", async () => {
  const fake = db({ board_posts: recentRows("board_posts", AUTHOR, BOARD_HOURLY_POST_LIMIT) });
  const result = await createBoardPost(
    asClient(fake),
    { actor: author, title: "제목", category: "free", contentHtml: "<p>본문</p>" },
    deps,
  );
  assert.deepEqual(result, { error: HOURLY_LIMIT_ERROR, status: 429 });
  assert.equal(fake.rowsOf("board_posts").length, BOARD_HOURLY_POST_LIMIT);
});

test("글 수정: 본인만, 비관리자는 is_pinned 를 건드리지 않는다", async () => {
  const fake = db({ board_posts: [post({ is_pinned: true })] });

  const denied = await updateBoardPost(
    asClient(fake),
    { actor: other, id: POST, title: "바꿈", category: "free", contentHtml: "<p>본문</p>" },
    deps,
  );
  assert.deepEqual(denied, { error: "권한이 없어요.", status: 403 });

  const ok = await updateBoardPost(
    asClient(fake),
    { actor: author, id: POST, title: "바꿈", category: "question", contentHtml: "<p>새 본문</p>", isPinned: false },
    deps,
  );
  assert.deepEqual(ok, { id: POST });
  const row = fake.rowsOf("board_posts")[0];
  assert.equal(row.title, "바꿈");
  assert.equal(row.category, "question");
  // 관리자가 걸어둔 고정은 그대로다.
  assert.equal(row.is_pinned, true);
  assert.equal(row.updated_at, NOW.toISOString());

  const missing = await updateBoardPost(
    asClient(fake),
    { actor: author, id: POST2, title: "x", category: "free", contentHtml: "<p>y</p>" },
    deps,
  );
  assert.deepEqual(missing, { error: "글을 찾을 수 없어요.", status: 404 });
  const badId = await updateBoardPost(
    asClient(fake),
    { actor: author, id: "not-a-uuid", title: "x", category: "free", contentHtml: "<p>y</p>" },
    deps,
  );
  assert.deepEqual(badId, { error: "잘못된 접근입니다.", status: 400 });
});

test("글 삭제: 본인 또는 관리자", async () => {
  const fake = db({ board_posts: [post(), post({ id: POST2 })] });
  assert.deepEqual(await deleteBoardPost(asClient(fake), { actor: other, id: POST }), {
    error: "권한이 없어요.",
    status: 403,
  });
  assert.deepEqual(await deleteBoardPost(asClient(fake), { actor: admin, id: POST }), { id: POST });
  assert.deepEqual(await deleteBoardPost(asClient(fake), { actor: author, id: POST2 }), { id: POST2 });
  assert.equal(fake.rowsOf("board_posts").length, 0);
});

// ── 댓글 ────────────────────────────────────────────────────────────────────

test("댓글 작성: 글쓴이에게 알림, 본인 글에는 알림 없음", async () => {
  const fake = db({ board_posts: [post()] });

  const result = await createBoardComment(
    asClient(fake),
    { actor: other, postId: POST, content: "  댓글  " },
    deps,
  );
  assert.deepEqual(result, { id: POST });
  const comment = fake.rowsOf("board_comments")[0];
  assert.equal(comment.content, "댓글");
  assert.equal(comment.nickname, "댓글러");
  assert.equal(comment.parent_id, null);

  const notes = fake.rowsOf("notifications");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].user_id, AUTHOR);
  assert.equal(notes[0].type, "board_comment");
  assert.equal(notes[0].actor_id, OTHER);
  assert.equal(notes[0].title, "원글");
  assert.equal(notes[0].preview, "댓글");
  assert.equal(notes[0].link, `/board/${POST}#comment-${comment.id}`);

  // 글쓴이가 자기 글에 댓글 — 알림이 늘지 않는다.
  await createBoardComment(asClient(fake), { actor: author, postId: POST, content: "답변" }, deps);
  assert.equal(fake.rowsOf("notifications").length, 1);
});

test("댓글 작성: 답글의 답글은 원 댓글에 접히고, 원 댓글 작성자와 글쓴이 둘에게 알린다", async () => {
  const fake = db({
    board_posts: [post()],
    board_comments: [
      { id: ROOT_COMMENT, post_id: POST, parent_id: null, user_id: OTHER, is_deleted: false },
      { id: REPLY, post_id: POST, parent_id: ROOT_COMMENT, user_id: ADMIN, is_deleted: false },
    ],
    users: [{ id: U("d"), user_metadata: { nickname: "제삼자" } }],
  });
  const third: BoardActor = { userId: U("d"), isAdmin: false };

  const result = await createBoardComment(
    asClient(fake),
    { actor: third, postId: POST, content: "답글의 답글", parentId: REPLY },
    deps,
  );
  assert.deepEqual(result, { id: POST });
  const created = fake.rowsOf("board_comments")[2];
  // REPLY 가 아니라 그 부모 ROOT_COMMENT 에 붙는다.
  assert.equal(created.parent_id, ROOT_COMMENT);
  // 닉네임은 세션이 안 넘겼으니 admin API 로 읽었다.
  assert.equal(created.nickname, "제삼자");

  const notes = fake.rowsOf("notifications");
  assert.deepEqual(
    notes.map((n) => [n.user_id, n.type]),
    // 대상 댓글(REPLY)의 작성자 ADMIN 에게 답글 알림, 글쓴이 AUTHOR 에게 댓글 알림.
    [
      [ADMIN, "board_reply"],
      [AUTHOR, "board_comment"],
    ],
  );
});

test("댓글 작성: 다른 글의 댓글 id 를 부모로 넘기면 거절", async () => {
  const fake = db({
    board_posts: [post(), post({ id: POST2 })],
    board_comments: [{ id: ROOT_COMMENT, post_id: POST2, parent_id: null, user_id: OTHER, is_deleted: false }],
  });
  const result = await createBoardComment(
    asClient(fake),
    { actor: author, postId: POST, content: "x", parentId: ROOT_COMMENT },
    deps,
  );
  assert.deepEqual(result, { error: "답글을 달 댓글을 찾을 수 없어요.", status: 404 });
  assert.equal(fake.rowsOf("board_comments").length, 1);
});

test("댓글 작성: 지워진 원 댓글에 답글을 달면 그 작성자에게는 알리지 않는다", async () => {
  const fake = db({
    board_posts: [post()],
    board_comments: [{ id: ROOT_COMMENT, post_id: POST, parent_id: null, user_id: OTHER, is_deleted: true }],
  });
  await createBoardComment(
    asClient(fake),
    { actor: admin, postId: POST, content: "x", parentId: ROOT_COMMENT },
    deps,
  );
  assert.deepEqual(
    fake.rowsOf("notifications").map((n) => [n.user_id, n.type]),
    [[AUTHOR, "board_comment"]],
  );
});

test("댓글 작성: 시간당 30건이면 거절, 없는 글이면 404, 빈 내용은 400", async () => {
  const fake = db({
    board_posts: [post()],
    board_comments: recentRows("board_comments", OTHER, BOARD_HOURLY_COMMENT_LIMIT, { post_id: POST }),
  });
  assert.deepEqual(
    await createBoardComment(asClient(fake), { actor: other, postId: POST, content: "x" }, deps),
    { error: HOURLY_LIMIT_ERROR, status: 429 },
  );
  assert.deepEqual(
    await createBoardComment(asClient(fake), { actor: other, postId: POST2, content: "x" }, deps),
    { error: "글을 찾을 수 없어요.", status: 404 },
  );
  assert.deepEqual(
    await createBoardComment(asClient(fake), { actor: other, postId: POST, content: "   " }, deps),
    { error: "댓글 내용을 입력해주세요.", status: 400 },
  );
});

test("댓글 작성: 알림 insert 가 실패해도 댓글은 성공이다", async () => {
  const fake = db({ board_posts: [post()] });
  fake.failNext.set("notifications", "boom");
  const result = await createBoardComment(
    asClient(fake),
    { actor: other, postId: POST, content: "댓글" },
    deps,
  );
  assert.deepEqual(result, { id: POST });
  assert.equal(fake.rowsOf("board_comments").length, 1);
  assert.equal(fake.rowsOf("notifications").length, 0);
});

test("댓글 수정: 본인만, 지워진 댓글은 없는 것으로 본다", async () => {
  const fake = db({
    board_comments: [
      { id: ROOT_COMMENT, post_id: POST, user_id: OTHER, content: "원문", is_deleted: false },
      { id: REPLY, post_id: POST, user_id: OTHER, content: "삭제된 댓글입니다.", is_deleted: true },
    ],
  });
  assert.deepEqual(
    await updateBoardComment(asClient(fake), { actor: author, commentId: ROOT_COMMENT, content: "x" }, deps),
    { error: "권한이 없어요.", status: 403 },
  );
  assert.deepEqual(
    await updateBoardComment(asClient(fake), { actor: other, commentId: REPLY, content: "x" }, deps),
    { error: "댓글을 찾을 수 없어요.", status: 404 },
  );
  assert.deepEqual(
    await updateBoardComment(asClient(fake), { actor: other, commentId: ROOT_COMMENT, content: "고침" }, deps),
    { id: POST },
  );
  assert.equal(fake.rowsOf("board_comments")[0].content, "고침");
  assert.equal(fake.rowsOf("board_comments")[0].updated_at, NOW.toISOString());
});

test("댓글 삭제: 답글이 있으면 소프트 삭제, 없으면 행 삭제, 관리자는 남의 것도", async () => {
  const fake = db({
    board_comments: [
      { id: ROOT_COMMENT, post_id: POST, parent_id: null, user_id: OTHER, content: "원 댓글", is_deleted: false },
      { id: REPLY, post_id: POST, parent_id: ROOT_COMMENT, user_id: AUTHOR, content: "답글", is_deleted: false },
    ],
  });

  assert.deepEqual(
    await deleteBoardComment(asClient(fake), { actor: author, commentId: ROOT_COMMENT }, deps),
    { error: "권한이 없어요.", status: 403 },
  );

  // 답글이 달린 원 댓글 → 표시만.
  assert.deepEqual(
    await deleteBoardComment(asClient(fake), { actor: other, commentId: ROOT_COMMENT }, deps),
    { id: POST },
  );
  const root = fake.rowsOf("board_comments").find((r) => r.id === ROOT_COMMENT)!;
  assert.equal(root.is_deleted, true);
  assert.equal(root.content, "삭제된 댓글입니다.");

  // 답글(아래 답글 없음) → 관리자가 행을 지운다.
  assert.deepEqual(
    await deleteBoardComment(asClient(fake), { actor: admin, commentId: REPLY }, deps),
    { id: POST },
  );
  assert.equal(fake.rowsOf("board_comments").some((r) => r.id === REPLY), false);
});

// ── 이미지 ──────────────────────────────────────────────────────────────────

function webp(width: number, height = 100): Uint8Array {
  const bytes = new Uint8Array(30);
  const put = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  put(0, "RIFF");
  bytes[4] = bytes.length - 8;
  put(8, "WEBP");
  put(12, "VP8 ");
  bytes[23] = 0x9d;
  bytes[24] = 0x01;
  bytes[25] = 0x2a;
  bytes[26] = width & 0xff;
  bytes[27] = (width >> 8) & 0x3f;
  bytes[28] = height & 0xff;
  bytes[29] = (height >> 8) & 0x3f;
  return bytes;
}

test("이미지: 정상 webp 는 {userId}/{uuid}.webp 로 올라가고 공개 URL 을 돌려준다", async () => {
  const fake = db();
  const result = await uploadBoardImage(asClient(fake), { userId: AUTHOR, webp: webp(BOARD_IMAGE_MAX_WIDTH) }, deps);
  const path = `${AUTHOR}/img-uuid.webp`;
  assert.deepEqual(result, { url: `${deps.imageOrigin}${path}` });
  assert.deepEqual(fake.uploads, [{ bucket: "board-images", paths: [path] }]);
});

test("이미지: 검사에 실패하면 버킷을 건드리지 않는다", async () => {
  const fake = db();
  const result = await uploadBoardImage(asClient(fake), { userId: AUTHOR, webp: webp(BOARD_IMAGE_MAX_WIDTH + 1) }, deps);
  assert.deepEqual(result, { error: "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.", status: 400 });
  assert.deepEqual(fake.uploads, []);
});

test("이미지: 한 시간 안에 60장이면 거절(스토리지 목록으로 센다)", async () => {
  const fake = db();
  // 60장 전부 지난 한 시간 **안**에(가장 오래된 것도 30분 전) 올라간 것으로 심는다.
  fake.objects["board-images"] = Array.from({ length: BOARD_HOURLY_IMAGE_LIMIT }, (_, i) => ({
    path: `${AUTHOR}/${i}.webp`,
    created_at: new Date(NOW.getTime() - 30 * 1000 * (i + 1)).toISOString(),
  }));
  const result = await uploadBoardImage(asClient(fake), { userId: AUTHOR, webp: webp(800) }, deps);
  assert.deepEqual(result, {
    error: "짧은 시간 동안 이미지를 너무 많이 올렸어요. 잠시 후 다시 시도해주세요.",
    status: 429,
  });
  assert.deepEqual(fake.uploads, []);

  // 한 시간이 지난 객체는 세지 않는다.
  fake.objects["board-images"] = fake.objects["board-images"].map((o) => ({
    ...o,
    created_at: new Date(NOW.getTime() - 2 * 60 * 60 * 1000).toISOString(),
  }));
  assert.ok("url" in (await uploadBoardImage(asClient(fake), { userId: AUTHOR, webp: webp(800) }, deps)));
});

test("이미지: 버킷이 없으면 다시 시도하라고 하지 않는다", async () => {
  const fake = db();
  fake.failNextUpload = "Bucket not found";
  const result = await uploadBoardImage(asClient(fake), { userId: AUTHOR, webp: webp(800) }, deps);
  assert.deepEqual(result, {
    error: "이미지 저장소가 아직 준비되지 않았어요. 운영자에게 알려주세요.",
    status: 500,
  });
});
