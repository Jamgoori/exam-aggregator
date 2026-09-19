import { test } from "node:test";
import assert from "node:assert/strict";
import { filterBlocked } from "@gongmoa/core";
import { blockedIdSet, fetchBlockedIdsWith, rpcErrorMessage, type BlockedRowsReader } from "./blocks";

// 차단 필터는 "내가 보는 화면"에서만 상대를 지우는 장치라 실패해도 조용히 빈 집합이어야 한다 —
// 여기서 잘못되면 두 방향 중 하나다: 차단한 사람이 계속 보이거나(집합이 비어 버림), 게시판이
// 통째로 비거나(오류가 던져짐). 둘 다 사용자 신고로만 드러나는 종류라 여기에 못박아 둔다.

function reader(result: { data: unknown; error: unknown }, calls: number[] = []): BlockedRowsReader {
  return {
    from: () => ({
      select: () => {
        calls.push(1);
        return Promise.resolve(result);
      },
    }),
  };
}

test("비로그인은 조회 없이 빈 집합이다", async () => {
  const calls: number[] = [];
  const ids = await fetchBlockedIdsWith(reader({ data: [{ blocked_id: "a" }], error: null }, calls), null);
  assert.equal(ids.size, 0);
  assert.equal(calls.length, 0);
});

test("로그인 사용자는 user_blocks 의 blocked_id 를 집합으로 받는다", async () => {
  const ids = await fetchBlockedIdsWith(
    reader({ data: [{ blocked_id: "a" }, { blocked_id: "b" }, { blocked_id: "a" }], error: null }),
    "me",
  );
  assert.deepEqual([...ids].sort(), ["a", "b"]);
});

test("행이 없거나 조회가 실패하면 빈 집합 — 게시판을 막지 않는다", () => {
  assert.equal(blockedIdSet([], null).size, 0);
  assert.equal(blockedIdSet(null, null).size, 0);
  // 1라운드 SQL 미적용(표 없음)·권한 오류 등. 던지지 않고 빈 집합.
  assert.equal(blockedIdSet(null, { code: "42P01", message: "relation does not exist" }).size, 0);
  // 모양이 어긋난 행(다른 컬럼·빈 문자열)은 버린다.
  assert.equal(blockedIdSet([{ user_id: "x" }, { blocked_id: "" }, null], null).size, 0);
});

test("core filterBlocked 로 목록·댓글을 거른다 — 빈 집합은 그대로, 탈퇴 회원(null)은 남는다", () => {
  const items = [
    { id: "1", authorId: "a" },
    { id: "2", authorId: "b" },
    { id: "3", authorId: null },
  ];
  const blocked = blockedIdSet([{ blocked_id: "a" }], null);
  assert.deepEqual(filterBlocked(items, blocked).map((i) => i.id), ["2", "3"]);
  assert.deepEqual(filterBlocked(items, new Set()).map((i) => i.id), ["1", "2", "3"]);
});

test("RPC 오류 문구는 raise exception(P0001)만 그대로, 나머지는 폴백", () => {
  assert.equal(rpcErrorMessage({ code: "P0001", message: "이미 신고한 글이에요." }, "폴백"), "이미 신고한 글이에요.");
  assert.equal(rpcErrorMessage({ code: "PGRST202", message: "Could not find the function" }, "폴백"), "폴백");
  assert.equal(rpcErrorMessage({ code: "P0001", message: "" }, "폴백"), "폴백");
  assert.equal(rpcErrorMessage(null, "폴백"), "폴백");
});
