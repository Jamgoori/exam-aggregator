import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeSupabase, asClient, type Row } from "../test-support/fake-supabase";
import { sendChatMessage, type ChatActor } from "./chat";
import { CHAT_BURST_LIMIT, CHAT_BURST_WINDOW_MS, CHAT_CONTENT_MAX, CHAT_MIN_INTERVAL_MS } from "../chat";

// 채팅 전송 규칙(설계서 §6.7 #20). 웹 chat/actions.ts 와 Edge `chat-send` 가 이 함수를 부른다. 보는 것:
//   1. 길이 — 빈 값·300자 초과는 400(웹 문장 그대로).
//   2. flood — 직전 메시지와 1.5초 안이면 429, 같은 말(대소문자·공백만 다른 것)의 반복이면 429.
//   3. burst — 10초 창 안에 5건이면 429(내용이 달라도).
//   4. 저장 — user_id·닉네임(user_metadata)·트림된 본문. 응답은 저장된 행 그대로.

const U = (n: string) => `${n.repeat(8)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(4)}-${n.repeat(12)}`;
const ME = U("a");
const OTHER = U("b");
const NOW = new Date("2026-09-19T03:00:00.000Z");
const deps = { now: () => NOW };
const me: ChatActor = { userId: ME, metadataNickname: "나" };

function msg(overrides: Row): Row {
  return { user_id: ME, nickname: "나", content: "이전 말", created_at: "2026-09-19T02:00:00.000Z", ...overrides };
}

function db(rows: Row[] = []) {
  return new FakeSupabase(
    { chat_messages: rows, users: [{ id: ME, user_metadata: { nickname: "나" } }] },
    { primaryKeys: { chat_messages: ["id"] } },
  );
}

test("길이: 빈 값·공백만·300자 초과는 400", async () => {
  const fake = db();
  assert.deepEqual(await sendChatMessage(asClient(fake), { actor: me, content: "   " }, deps), {
    error: "메시지를 입력해주세요.",
    status: 400,
  });
  assert.deepEqual(await sendChatMessage(asClient(fake), { actor: me, content: "가".repeat(CHAT_CONTENT_MAX + 1) }, deps), {
    error: `메시지는 ${CHAT_CONTENT_MAX}자 이하로 입력해주세요.`,
    status: 400,
  });
  assert.equal(fake.rowsOf("chat_messages").length, 0);
});

test("flood: 직전 메시지와 최소 간격 안이면 429", async () => {
  const fake = db([msg({ id: "m0", created_at: new Date(NOW.getTime() - CHAT_MIN_INTERVAL_MS + 100).toISOString() })]);
  assert.deepEqual(await sendChatMessage(asClient(fake), { actor: me, content: "새 말" }, deps), {
    error: "너무 빨리 보내고 있어요. 잠시 후 다시 시도해주세요.",
    status: 429,
  });
});

test("flood: 같은 말의 반복은 429 — 대소문자·앞뒤 공백만 다른 것도 같은 말", async () => {
  const fake = db([msg({ id: "m0", content: "Hello" })]);
  assert.deepEqual(await sendChatMessage(asClient(fake), { actor: me, content: "  hello " }, deps), {
    error: "같은 메시지를 반복해서 보낼 수 없어요.",
    status: 429,
  });
  // 남이 보낸 같은 말은 상관없다 — 직전 메시지는 **내** 것만 본다.
  const others = db([msg({ id: "m0", user_id: OTHER, content: "hello" })]);
  const ok = await sendChatMessage(asClient(others), { actor: me, content: "hello" }, deps);
  assert.ok("message" in ok);
});

test("burst: 창 안에 5건이면 내용이 달라도 429, 창 밖 건은 세지 않는다", async () => {
  const inWindow: Row[] = [];
  for (let i = 0; i < CHAT_BURST_LIMIT; i++) {
    inWindow.push(msg({ id: `m${i}`, content: `말${i}`, created_at: new Date(NOW.getTime() - CHAT_BURST_WINDOW_MS + 1000 + i).toISOString() }));
  }
  // 직전 메시지는 최소 간격 밖에 두어 burst 만 걸리게 한다.
  inWindow[inWindow.length - 1].created_at = new Date(NOW.getTime() - CHAT_MIN_INTERVAL_MS - 1).toISOString();
  const fake = db(inWindow);
  assert.deepEqual(await sendChatMessage(asClient(fake), { actor: me, content: "다른 말" }, deps), {
    error: "메시지를 너무 자주 보내고 있어요. 잠시 후 다시 시도해주세요.",
    status: 429,
  });

  const outside = db(inWindow.map((r) => ({ ...r, created_at: "2026-09-19T02:00:00.000Z" })));
  const ok = await sendChatMessage(asClient(outside), { actor: me, content: "다른 말" }, deps);
  assert.ok("message" in ok);
});

test("저장: 트림된 본문·user_metadata 닉네임으로 insert 하고 저장된 행을 돌려준다", async () => {
  const fake = db();
  const r = await sendChatMessage(asClient(fake), { actor: me, content: "  안녕하세요  " }, deps);
  assert.ok("message" in r);
  if (!("message" in r)) return;
  assert.equal(r.message.userId, ME);
  assert.equal(r.message.nickname, "나");
  assert.equal(r.message.content, "안녕하세요");
  assert.equal(typeof r.message.id, "string");
  const row = fake.rowsOf("chat_messages")[0];
  assert.equal(row.content, "안녕하세요");
  assert.equal(row.user_id, ME);
});

test("Edge 경로: metadataNickname 이 없으면 admin API 에서 닉네임을 읽는다", async () => {
  const fake = db();
  const r = await sendChatMessage(asClient(fake), { actor: { userId: ME } , content: "안녕" }, deps);
  assert.ok("message" in r && r.message.nickname === "나");
});
