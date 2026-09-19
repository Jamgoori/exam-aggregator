import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient, type Row } from "../test-support/fake-supabase";
import {
  answerSuggestion,
  countSuggestionView,
  createSuggestion,
  createSuggestionComment,
  deleteSuggestion,
  deleteSuggestionComment,
  fetchSuggestion,
  fetchSuggestionComments,
  fetchSuggestionPage,
  readSuggestionComments,
  updateSuggestion,
  updateSuggestionComment,
  type SuggestionActor,
} from "./suggestions";
import { HOURLY_LIMIT_ERROR, SUGGESTION_COMMENT_HOURLY_LIMIT, SUGGESTION_HOURLY_LIMIT } from "./hourly-limit";
import { SECRET_TITLE_PLACEHOLDER, SUGGESTIONS_PAGE_SIZE } from "../suggestions";

// 건의게시판 규칙(설계서 §6.7 #19). 웹 lib/suggestions.ts·suggestions/actions.ts 와 Edge `suggestions`
// 가 **이 함수**를 부르므로, 여기서 지키는 것이 곧 두 경로가 같다는 뜻이다. 보는 것:
//   1. 마스킹 — 볼 수 없는 비밀글은 목록에서 제목이 "비밀글입니다." 로 바뀌고 readable=false.
//   2. forbidden — 남의 비밀글 상세는 forbidden, 본인·관리자는 ok. 댓글 읽기도 같은 판단.
//   3. 조회수 — 본인·관리자는 세지 않는다. 탈퇴한 회원의 글(authorId null)은 비로그인도 센다.
//   4. 비밀글 댓글 — 볼 수 없는 사람의 댓글 작성은 "잘못된 접근입니다."(403).
//   5. 시간당 한도 — 글 10·댓글 30.
//   6. 알림 — 댓글은 글쓴이에게, 답변은 글쓴이에게 "운영자" 명의로. 본인 제외·탈퇴한 회원 제외.
//   7. 쓰기 문장의 소유자 조건 — 수정·삭제는 본인 행만 건드린다(관리자 삭제는 예외).

const U = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
const AUTHOR = U("a");
const OTHER = U("b");
const ADMIN = U("c");
const PUBLIC_POST = U("1");
const SECRET_POST = U("2");
const ORPHAN_POST = U("3");
const COMMENT = U("4");

const NOW = new Date("2026-09-19T03:00:00.000Z");
const deps = { now: () => NOW };

const author: SuggestionActor = { userId: AUTHOR, isAdmin: false, metadataNickname: "글쓴이" };
const other: SuggestionActor = { userId: OTHER, isAdmin: false, metadataNickname: "댓글러" };
const admin: SuggestionActor = { userId: ADMIN, isAdmin: true, metadataNickname: "운영자" };
const anon = { userId: null, isAdmin: false };

function post(overrides: Row): Row {
  return {
    user_id: AUTHOR,
    nickname: "글쓴이",
    title: "제목",
    content: "내용",
    is_secret: false,
    is_pinned: false,
    view_count: 0,
    answer: null,
    answered_at: null,
    answered_by: null,
    created_at: "2026-09-19T01:00:00.000Z",
    updated_at: null,
    ...overrides,
  };
}

function db(tables: Record<string, Row[]> = {}) {
  return new FakeSupabase(
    {
      suggestions: [
        post({ id: PUBLIC_POST }),
        post({ id: SECRET_POST, title: "비밀 제목", is_secret: true, created_at: "2026-09-19T02:00:00.000Z" }),
        // 탈퇴한 회원의 글(§12-2 #17).
        post({ id: ORPHAN_POST, user_id: null, nickname: "탈퇴한 회원", title: "탈퇴한 회원의 글", created_at: "2026-09-19T00:00:00.000Z" }),
      ],
      suggestion_comments: [],
      notifications: [],
      users: [{ id: AUTHOR, user_metadata: { nickname: "글쓴이" } }],
      ...tables,
    },
    { primaryKeys: { suggestions: ["id"], suggestion_comments: ["id"] } },
  );
}

// ── 읽기 ────────────────────────────────────────────────────────────────────

test("목록: 남의 비밀글은 제목이 가려지고 readable=false, 본인·관리자에게는 그대로", async () => {
  const fake = db();
  const forOther = await fetchSuggestionPage(asClient(fake), 1, other);
  const secret = forOther.items.find((i) => i.id === SECRET_POST)!;
  assert.equal(secret.title, SECRET_TITLE_PLACEHOLDER);
  assert.equal(secret.readable, false);
  assert.equal(secret.isSecret, true);
  // 차단 필터용 authorId — 볼 수 없는 비밀글에도 실리고(닉네임이 이미 보이는 자리), 탈퇴한 회원의 글은 null.
  assert.equal(secret.authorId, AUTHOR);
  assert.equal(forOther.items.find((i) => i.id === ORPHAN_POST)!.authorId, null);
  // 비로그인도 같다.
  const forAnon = await fetchSuggestionPage(asClient(fake), 1, anon);
  assert.equal(forAnon.items.find((i) => i.id === SECRET_POST)!.title, SECRET_TITLE_PLACEHOLDER);

  const forAuthor = await fetchSuggestionPage(asClient(fake), 1, author);
  assert.equal(forAuthor.items.find((i) => i.id === SECRET_POST)!.title, "비밀 제목");
  assert.equal(forAuthor.items.find((i) => i.id === SECRET_POST)!.readable, true);
  const forAdmin = await fetchSuggestionPage(asClient(fake), 1, admin);
  assert.equal(forAdmin.items.find((i) => i.id === SECRET_POST)!.title, "비밀 제목");

  // 최신순·페이지 계산.
  assert.deepEqual(forOther.items.map((i) => i.id), [SECRET_POST, PUBLIC_POST, ORPHAN_POST]);
  assert.equal(forOther.total, 3);
  assert.equal(forOther.totalPages, 1);
});

test("목록: 고정글은 1페이지에만 따로 실리고 일반 글 개수에서 빠진다", async () => {
  const fake = db({
    suggestions: [
      post({ id: PUBLIC_POST }),
      post({ id: U("9"), title: "공지", is_pinned: true }),
    ],
  });
  const page1 = await fetchSuggestionPage(asClient(fake), 1, anon);
  assert.deepEqual(page1.pinnedItems.map((i) => i.title), ["공지"]);
  assert.equal(page1.total, 1);
  const page2 = await fetchSuggestionPage(asClient(fake), 2, anon);
  assert.deepEqual(page2.pinnedItems, []);
  assert.equal(page2.items.length, 0);
});

test("목록: 페이지 크기는 SUGGESTIONS_PAGE_SIZE", async () => {
  const rows: Row[] = [];
  for (let i = 0; i < SUGGESTIONS_PAGE_SIZE + 3; i++) {
    rows.push(post({ id: `${i}`, created_at: `2026-09-01T00:00:${String(i).padStart(2, "0")}.000Z` }));
  }
  const fake = db({ suggestions: rows });
  const page1 = await fetchSuggestionPage(asClient(fake), 1, anon);
  assert.equal(page1.items.length, SUGGESTIONS_PAGE_SIZE);
  assert.equal(page1.totalPages, 2);
  const page2 = await fetchSuggestionPage(asClient(fake), 2, anon);
  assert.equal(page2.items.length, 3);
});

test("상세: 없는 글 not_found, 남의 비밀글 forbidden, 본인·관리자 ok(canEdit 는 본인만)", async () => {
  const fake = db();
  assert.deepEqual(await fetchSuggestion(asClient(fake), U("f"), other), { status: "not_found" });
  assert.deepEqual(await fetchSuggestion(asClient(fake), SECRET_POST, other), { status: "forbidden" });
  assert.deepEqual(await fetchSuggestion(asClient(fake), SECRET_POST, anon), { status: "forbidden" });

  const mine = await fetchSuggestion(asClient(fake), SECRET_POST, author);
  assert.equal(mine.status, "ok");
  if (mine.status !== "ok") return;
  assert.equal(mine.suggestion.content, "내용");
  assert.equal(mine.suggestion.canEdit, true);
  assert.equal(mine.suggestion.canDelete, true);
  assert.equal(mine.suggestion.authorId, AUTHOR);

  const asAdmin = await fetchSuggestion(asClient(fake), SECRET_POST, admin);
  assert.equal(asAdmin.status, "ok");
  if (asAdmin.status !== "ok") return;
  assert.equal(asAdmin.suggestion.canEdit, false);
  assert.equal(asAdmin.suggestion.canDelete, true);
});

test("상세: 탈퇴한 회원의 글은 authorId null 이고 아무도 수정할 수 없다(관리자 삭제만)", async () => {
  const fake = db();
  const forAnon = await fetchSuggestion(asClient(fake), ORPHAN_POST, anon);
  assert.equal(forAnon.status, "ok");
  if (forAnon.status !== "ok") return;
  assert.equal(forAnon.suggestion.authorId, null);
  assert.equal(forAnon.suggestion.canEdit, false);
  assert.equal(forAnon.suggestion.canDelete, false);
  const forAdmin = await fetchSuggestion(asClient(fake), ORPHAN_POST, admin);
  assert.equal(forAdmin.status === "ok" && forAdmin.suggestion.canDelete, true);
  assert.equal(forAdmin.status === "ok" && forAdmin.suggestion.canEdit, false);
});

test("조회수: 본인·관리자는 세지 않고, 남·비로그인은 센다. 탈퇴한 회원의 글은 비로그인도 센다", async () => {
  const fake = db();
  await countSuggestionView(asClient(fake), PUBLIC_POST, author, AUTHOR);
  await countSuggestionView(asClient(fake), PUBLIC_POST, admin, AUTHOR);
  assert.equal(fake.rpcs.length, 0);

  await countSuggestionView(asClient(fake), PUBLIC_POST, other, AUTHOR);
  await countSuggestionView(asClient(fake), PUBLIC_POST, anon, AUTHOR);
  assert.equal(fake.rpcs.length, 2);
  assert.deepEqual(fake.rpcs[0], { name: "increment_suggestion_view", args: { p_suggestion_id: PUBLIC_POST } });

  // authorId null 과 userId null 이 같다고 "본인"으로 보면 안 된다.
  await countSuggestionView(asClient(fake), ORPHAN_POST, anon, null);
  assert.equal(fake.rpcs.length, 3);
});

test("댓글 읽기: readSuggestionComments 는 원글 권한을 다시 본다", async () => {
  const fake = db({
    suggestion_comments: [
      { id: COMMENT, suggestion_id: SECRET_POST, user_id: OTHER, nickname: "댓글러", content: "댓글", created_at: "2026-09-19T02:30:00.000Z", updated_at: null },
    ],
  });
  assert.deepEqual(await readSuggestionComments(asClient(fake), U("f"), other), { status: "not_found" });
  assert.deepEqual(await readSuggestionComments(asClient(fake), SECRET_POST, other), { status: "forbidden" });
  const ok = await readSuggestionComments(asClient(fake), SECRET_POST, author);
  assert.equal(ok.status, "ok");
  if (ok.status !== "ok") return;
  assert.equal(ok.items.length, 1);
  assert.equal(ok.items[0].canEdit, false);
  assert.equal(ok.items[0].canDelete, false);
  assert.equal(ok.items[0].authorId, OTHER);

  // 권한 판정은 보는 사람 기준 — 댓글 작성자에게는 수정·삭제가 열린다.
  const asOther = await fetchSuggestionComments(asClient(fake), SECRET_POST, other);
  assert.equal(asOther[0].canEdit, true);
  assert.equal(asOther[0].canDelete, true);
});

// ── 글 쓰기 ─────────────────────────────────────────────────────────────────

test("작성: 검증 → 고정·비밀 확정 → 한도 → insert. 비관리자의 isPinned 는 무시", async () => {
  const fake = db({ suggestions: [] });
  const bad = await createSuggestion(asClient(fake), { actor: author, title: "", content: "내용", isSecret: false }, deps);
  assert.deepEqual(bad, { error: "제목을 입력해주세요.", status: 400 });

  const r = await createSuggestion(
    asClient(fake),
    { actor: author, title: "제목", content: "내용", isSecret: true, isPinned: true },
    deps,
  );
  assert.ok("id" in r);
  const row = fake.rowsOf("suggestions")[0];
  assert.equal(row.is_pinned, false);
  assert.equal(row.is_secret, true);
  assert.equal(row.nickname, "글쓴이");
  assert.equal(row.user_id, AUTHOR);
});

test("작성: 관리자가 고정하면 비밀글 여부는 강제로 꺼진다", async () => {
  const fake = db({ suggestions: [] });
  await createSuggestion(
    asClient(fake),
    { actor: admin, title: "공지", content: "내용", isSecret: true, isPinned: true },
    deps,
  );
  const row = fake.rowsOf("suggestions")[0];
  assert.equal(row.is_pinned, true);
  assert.equal(row.is_secret, false);
});

test("작성: 시간당 10건을 넘기면 429", async () => {
  const rows: Row[] = [];
  for (let i = 0; i < SUGGESTION_HOURLY_LIMIT; i++) {
    rows.push(post({ id: `r${i}`, created_at: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString() }));
  }
  const fake = db({ suggestions: rows });
  const r = await createSuggestion(asClient(fake), { actor: author, title: "제목", content: "내용", isSecret: false }, deps);
  assert.deepEqual(r, { error: HOURLY_LIMIT_ERROR, status: 429 });
  // 한 시간이 지난 글은 세지 않는다.
  const old = db({ suggestions: rows.map((r) => ({ ...r, created_at: "2026-09-19T01:00:00.000Z" })) });
  const ok = await createSuggestion(asClient(old), { actor: author, title: "제목", content: "내용", isSecret: false }, deps);
  assert.ok("id" in ok);
});

test("수정: 본인만(관리자도 403), 없는 글 404, 잘못된 id 400, 쓰기 문장에 소유자 조건", async () => {
  const fake = db();
  assert.deepEqual(
    await updateSuggestion(asClient(fake), { actor: author, id: "abc", title: "t", content: "c", isSecret: false }, deps),
    { error: "잘못된 접근입니다.", status: 400 },
  );
  assert.deepEqual(
    await updateSuggestion(asClient(fake), { actor: author, id: U("f"), title: "t", content: "c", isSecret: false }, deps),
    { error: "글을 찾을 수 없어요.", status: 404 },
  );
  assert.deepEqual(
    await updateSuggestion(asClient(fake), { actor: other, id: PUBLIC_POST, title: "t", content: "c", isSecret: false }, deps),
    { error: "권한이 없어요.", status: 403 },
  );
  assert.deepEqual(
    await updateSuggestion(asClient(fake), { actor: admin, id: PUBLIC_POST, title: "t", content: "c", isSecret: false }, deps),
    { error: "권한이 없어요.", status: 403 },
  );
  // 탈퇴한 회원의 글은 아무도 수정하지 못한다.
  assert.deepEqual(
    await updateSuggestion(asClient(fake), { actor: author, id: ORPHAN_POST, title: "t", content: "c", isSecret: false }, deps),
    { error: "권한이 없어요.", status: 403 },
  );

  const ok = await updateSuggestion(
    asClient(fake),
    { actor: author, id: PUBLIC_POST, title: "고침", content: "내용2", isSecret: true },
    deps,
  );
  assert.deepEqual(ok, { id: PUBLIC_POST });
  const write = fake.writes.find((w) => w.table === "suggestions" && w.op === "update")!;
  assert.equal(write.matched.length, 1);
  assert.equal(write.matched[0].id, PUBLIC_POST);
  assert.equal(write.matched[0].user_id, AUTHOR);
  assert.equal(write.values[0].title, "고침");
  assert.equal(write.values[0].is_secret, true);
  assert.equal(write.values[0].updated_at, NOW.toISOString());
});

test("삭제: 본인·관리자만. 비관리자 delete 문장에는 소유자 조건이 붙는다", async () => {
  const fake = db();
  assert.deepEqual(await deleteSuggestion(asClient(fake), { actor: other, id: PUBLIC_POST }), {
    error: "권한이 없어요.",
    status: 403,
  });
  assert.deepEqual(await deleteSuggestion(asClient(fake), { actor: author, id: PUBLIC_POST }), { id: PUBLIC_POST });
  assert.equal(fake.rowsOf("suggestions").some((r) => r.id === PUBLIC_POST), false);
  // 관리자는 남의 글(탈퇴한 회원의 글 포함)을 지운다.
  assert.deepEqual(await deleteSuggestion(asClient(fake), { actor: admin, id: ORPHAN_POST }), { id: ORPHAN_POST });
  assert.equal(fake.rowsOf("suggestions").some((r) => r.id === ORPHAN_POST), false);
});

test("답변: 관리자만. 글쓴이에게 '운영자' 명의 suggestion_answer 알림, 탈퇴한 회원의 글이면 알림 없음", async () => {
  const fake = db();
  assert.deepEqual(await answerSuggestion(asClient(fake), { actor: author, id: PUBLIC_POST, answer: "답" }, deps), {
    error: "권한이 없어요.",
    status: 403,
  });
  assert.deepEqual(await answerSuggestion(asClient(fake), { actor: admin, id: PUBLIC_POST, answer: " " }, deps), {
    error: "답변 내용을 입력해주세요.",
    status: 400,
  });

  const ok = await answerSuggestion(asClient(fake), { actor: admin, id: PUBLIC_POST, answer: "답변입니다" }, deps);
  assert.deepEqual(ok, { id: PUBLIC_POST });
  const row = fake.rowsOf("suggestions").find((r) => r.id === PUBLIC_POST)!;
  assert.equal(row.answer, "답변입니다");
  assert.equal(row.answered_by, ADMIN);
  assert.equal(row.answered_at, NOW.toISOString());
  const notes = fake.rowsOf("notifications");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].user_id, AUTHOR);
  assert.equal(notes[0].type, "suggestion_answer");
  assert.equal(notes[0].actor_nickname, "운영자");
  assert.equal(notes[0].link, `/suggestions/${PUBLIC_POST}`);

  await answerSuggestion(asClient(fake), { actor: admin, id: ORPHAN_POST, answer: "답변입니다" }, deps);
  assert.equal(fake.rowsOf("notifications").length, 1);
});

// ── 댓글 쓰기 ───────────────────────────────────────────────────────────────

test("댓글 작성: 볼 수 없는 비밀글에는 '잘못된 접근입니다.'(403), 볼 수 있으면 등록 + 글쓴이 알림", async () => {
  const fake = db();
  assert.deepEqual(
    await createSuggestionComment(asClient(fake), { actor: other, suggestionId: SECRET_POST, content: "댓글" }, deps),
    { error: "잘못된 접근입니다.", status: 403 },
  );
  assert.equal(fake.rowsOf("suggestion_comments").length, 0);

  const r = await createSuggestionComment(asClient(fake), { actor: other, suggestionId: PUBLIC_POST, content: "댓글" }, deps);
  assert.deepEqual(r, { id: PUBLIC_POST });
  const row = fake.rowsOf("suggestion_comments")[0];
  assert.equal(row.user_id, OTHER);
  assert.equal(row.nickname, "댓글러");
  const notes = fake.rowsOf("notifications");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].user_id, AUTHOR);
  assert.equal(notes[0].type, "suggestion_comment");
  assert.equal(notes[0].actor_id, OTHER);

  // 관리자는 비밀글에도 댓글을 단다.
  const byAdmin = await createSuggestionComment(asClient(fake), { actor: admin, suggestionId: SECRET_POST, content: "확인" }, deps);
  assert.deepEqual(byAdmin, { id: SECRET_POST });
});

test("댓글 작성: 본인 글에 단 댓글은 알림이 없고, 탈퇴한 회원의 글도 알림이 없다", async () => {
  const fake = db();
  await createSuggestionComment(asClient(fake), { actor: author, suggestionId: PUBLIC_POST, content: "셀프" }, deps);
  await createSuggestionComment(asClient(fake), { actor: other, suggestionId: ORPHAN_POST, content: "댓글" }, deps);
  assert.equal(fake.rowsOf("suggestion_comments").length, 2);
  assert.equal(fake.rowsOf("notifications").length, 0);
});

test("댓글 작성: 시간당 30건을 넘기면 429, 없는 글 404, 빈 내용 400", async () => {
  const rows: Row[] = [];
  for (let i = 0; i < SUGGESTION_COMMENT_HOURLY_LIMIT; i++) {
    rows.push({ id: `c${i}`, suggestion_id: PUBLIC_POST, user_id: OTHER, nickname: "댓글러", content: "x", created_at: new Date(NOW.getTime() - 60 * 1000).toISOString() });
  }
  const fake = db({ suggestion_comments: rows });
  assert.deepEqual(
    await createSuggestionComment(asClient(fake), { actor: other, suggestionId: PUBLIC_POST, content: "댓글" }, deps),
    { error: HOURLY_LIMIT_ERROR, status: 429 },
  );
  assert.deepEqual(
    await createSuggestionComment(asClient(fake), { actor: other, suggestionId: U("f"), content: "댓글" }, deps),
    { error: "글을 찾을 수 없어요.", status: 404 },
  );
  assert.deepEqual(
    await createSuggestionComment(asClient(fake), { actor: other, suggestionId: PUBLIC_POST, content: " " }, deps),
    { error: "댓글 내용을 입력해주세요.", status: 400 },
  );
});

test("댓글 수정·삭제: 본인만 수정, 삭제는 본인+관리자, 쓰기 문장에 소유자 조건", async () => {
  const fake = db({
    suggestion_comments: [
      { id: COMMENT, suggestion_id: PUBLIC_POST, user_id: OTHER, nickname: "댓글러", content: "댓글", created_at: "2026-09-19T02:30:00.000Z", updated_at: null },
    ],
  });
  assert.deepEqual(await updateSuggestionComment(asClient(fake), { actor: author, commentId: COMMENT, content: "고침" }, deps), {
    error: "권한이 없어요.",
    status: 403,
  });
  assert.deepEqual(await updateSuggestionComment(asClient(fake), { actor: admin, commentId: COMMENT, content: "고침" }, deps), {
    error: "권한이 없어요.",
    status: 403,
  });
  assert.deepEqual(await updateSuggestionComment(asClient(fake), { actor: other, commentId: U("f"), content: "고침" }, deps), {
    error: "댓글을 찾을 수 없어요.",
    status: 404,
  });
  assert.deepEqual(await updateSuggestionComment(asClient(fake), { actor: other, commentId: COMMENT, content: "고침" }, deps), {
    id: PUBLIC_POST,
  });
  const upd = fake.writes.find((w) => w.table === "suggestion_comments" && w.op === "update")!;
  assert.equal(upd.matched[0].user_id, OTHER);
  assert.equal(upd.values[0].content, "고침");

  assert.deepEqual(await deleteSuggestionComment(asClient(fake), { actor: author, commentId: COMMENT }), {
    error: "권한이 없어요.",
    status: 403,
  });
  assert.deepEqual(await deleteSuggestionComment(asClient(fake), { actor: admin, commentId: COMMENT }), { id: PUBLIC_POST });
  assert.equal(fake.rowsOf("suggestion_comments").length, 0);
});

test("Edge 경로: metadataNickname 이 없으면 admin API 에서 닉네임을 읽는다", async () => {
  const fake = db({ suggestions: [] });
  await createSuggestion(asClient(fake), { actor: { userId: AUTHOR, isAdmin: false }, title: "제목", content: "내용", isSecret: false }, deps);
  assert.equal(fake.rowsOf("suggestions")[0].nickname, "글쓴이");
});
