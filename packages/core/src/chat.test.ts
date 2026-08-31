import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_BURST_LIMIT,
  CHAT_CLEAR_CONFIRM_TEXT,
  CHAT_MIN_INTERVAL_MS,
  checkChatBurst,
  checkChatClearConfirmation,
  checkChatFlood,
} from "./chat";

test("첫 메시지(직전 기록 없음)는 항상 통과", () => {
  assert.deepEqual(checkChatFlood(null, "안녕하세요", 0), { ok: true });
});

test("최소 간격보다 빨리 보내면 거절", () => {
  const last = { content: "안녕하세요", createdAtMs: 1000 };
  const result = checkChatFlood(last, "또 왔어요", 1000 + CHAT_MIN_INTERVAL_MS - 1);
  assert.equal(result.ok, false);
});

test("최소 간격을 채우면 통과", () => {
  const last = { content: "안녕하세요", createdAtMs: 1000 };
  const result = checkChatFlood(last, "또 왔어요", 1000 + CHAT_MIN_INTERVAL_MS);
  assert.equal(result.ok, true);
});

test("간격을 지켜도 같은 내용을 반복하면 거절", () => {
  const last = { content: "안녕하세요", createdAtMs: 1000 };
  const result = checkChatFlood(last, "안녕하세요", 1000 + CHAT_MIN_INTERVAL_MS);
  assert.equal(result.ok, false);
});

test("대소문자·앞뒤 공백만 다른 반복도 걸린다", () => {
  const last = { content: "Hello", createdAtMs: 1000 };
  const result = checkChatFlood(last, "  hello  ", 1000 + CHAT_MIN_INTERVAL_MS);
  assert.equal(result.ok, false);
});

test("burst 한도 미만이면 통과", () => {
  assert.deepEqual(checkChatBurst(CHAT_BURST_LIMIT - 1), { ok: true });
});

test("burst 한도에 닿으면 거절", () => {
  const result = checkChatBurst(CHAT_BURST_LIMIT);
  assert.equal(result.ok, false);
});

test("확인 문구가 정확히 같으면 초기화 통과(앞뒤 공백은 허용)", () => {
  assert.deepEqual(checkChatClearConfirmation(`  ${CHAT_CLEAR_CONFIRM_TEXT} `), { ok: true });
});

test("확인 문구가 다르면 초기화 거절", () => {
  assert.equal(checkChatClearConfirmation("초기화").ok, false);
  assert.equal(checkChatClearConfirmation("").ok, false);
});
