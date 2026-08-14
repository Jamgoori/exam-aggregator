import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, grantedExpiry, revokedExpiry } from "./payment";
import type { Membership } from "./membership";

const NOW = new Date("2026-08-14T11:00:00.000Z"); // = KST 8/14 20:00

function membership(over: Partial<Membership> = {}): Membership {
  return {
    tier: "premium",
    source: "trial",
    startedAt: "2026-07-01T00:00:00.000Z",
    expiresAt: null,
    ...over,
  };
}

test("addMonths: 시:분을 보존하며 달을 더한다", () => {
  assert.equal(
    addMonths(new Date("2026-08-14T11:00:00.000Z"), 1).toISOString(),
    "2026-09-14T11:00:00.000Z",
  );
  assert.equal(
    addMonths(new Date("2026-08-14T11:00:00.000Z"), 12).toISOString(),
    "2027-08-14T11:00:00.000Z",
  );
});

test("addMonths: 말일은 다음 달로 굴러넘치지 않고 그 달 말일로 잘린다", () => {
  // setMonth 를 그냥 쓰면 3월 3일이 된다 — 1개월권에 사흘을 더 주게 된다.
  assert.equal(
    addMonths(new Date("2026-01-31T00:00:00.000Z"), 1).toISOString(),
    "2026-02-28T00:00:00.000Z",
  );
  // 윤년(2028)은 29일까지 있다.
  assert.equal(
    addMonths(new Date("2028-01-31T00:00:00.000Z"), 1).toISOString(),
    "2028-02-29T00:00:00.000Z",
  );
  assert.equal(
    addMonths(new Date("2026-05-31T00:00:00.000Z"), 1).toISOString(),
    "2026-06-30T00:00:00.000Z",
  );
});

test("addMonths: 음수는 반대 방향으로 같은 규칙을 쓴다", () => {
  assert.equal(
    addMonths(new Date("2026-03-31T00:00:00.000Z"), -1).toISOString(),
    "2026-02-28T00:00:00.000Z",
  );
  assert.equal(
    addMonths(new Date("2027-08-14T11:00:00.000Z"), -12).toISOString(),
    "2026-08-14T11:00:00.000Z",
  );
});

test("grantedExpiry: 무료 회원은 지금부터 시작한다", () => {
  const free = membership({ tier: "free", expiresAt: null });
  assert.equal(grantedExpiry(free, 12, NOW), "2027-08-14T11:00:00.000Z");
  // 멤버십 행 자체가 없는 계정도 마찬가지.
  assert.equal(grantedExpiry(null, 1, NOW), "2026-09-14T11:00:00.000Z");
});

test("grantedExpiry: 남은 체험 기간에 이어 붙인다", () => {
  // 체험이 20일 남은 사람이 1년권을 사면 385일이 되어야 한다.
  const trial = membership({ expiresAt: "2026-09-03T11:00:00.000Z" });
  assert.equal(grantedExpiry(trial, 12, NOW), "2027-09-03T11:00:00.000Z");
});

test("grantedExpiry: 이미 만료된 기간에는 이어 붙이지 않는다", () => {
  // 만료 직전에 결제한 요청이 승인까지 몇 초 걸려 그 사이에 만료된 경우.
  const expired = membership({ expiresAt: "2026-08-14T10:59:00.000Z" });
  assert.equal(grantedExpiry(expired, 1, NOW), "2026-09-14T11:00:00.000Z");
});

test("grantedExpiry: 무기한 프리미엄은 유한하게 만들지 않는다", () => {
  const unlimited = membership({ source: "paid", expiresAt: null });
  assert.equal(grantedExpiry(unlimited, 12, NOW), null);
});

test("revokedExpiry: 부여한 기간을 정확히 되돌린다", () => {
  // 체험 20일 남은 상태에서 1년권 결제 → 환불하면 체험 20일이 그대로 남아야 한다.
  const afterPaid = membership({ source: "paid", expiresAt: "2027-09-03T11:00:00.000Z" });
  assert.equal(revokedExpiry(afterPaid, 12, NOW), "2026-09-03T11:00:00.000Z");
});

test("revokedExpiry: 되돌린 결과가 과거면 지금으로 자른다", () => {
  const afterPaid = membership({ source: "paid", expiresAt: "2026-09-14T11:00:00.000Z" });
  // 무료 회원이 1개월권을 사서 지금이 만료일-1개월 지점 → 되돌리면 정확히 지금.
  assert.equal(revokedExpiry(afterPaid, 1, NOW), NOW.toISOString());

  // 이미 상당 기간 쓴 뒤 환불한 경우에도 과거로 박히지 않는다.
  const used = membership({ source: "paid", expiresAt: "2026-08-20T11:00:00.000Z" });
  assert.equal(revokedExpiry(used, 12, NOW), NOW.toISOString());
});

test("revokedExpiry: 만료가 없던 계정은 즉시 끊는다", () => {
  const unlimited = membership({ source: "paid", expiresAt: null });
  assert.equal(revokedExpiry(unlimited, 12, NOW), NOW.toISOString());
});

test("grantedExpiry ↔ revokedExpiry 는 서로의 역이다", () => {
  for (const months of [1, 3, 12]) {
    for (const expiresAt of [null, "2026-09-03T11:00:00.000Z", "2026-12-31T15:00:00.000Z"]) {
      const before = membership({ tier: expiresAt ? "premium" : "free", expiresAt });
      const granted = grantedExpiry(before, months, NOW);
      assert.ok(granted, "유한 만료가 나와야 한다");
      const after = membership({ source: "paid", expiresAt: granted });
      const expected = expiresAt && new Date(expiresAt) > NOW ? expiresAt : NOW.toISOString();
      assert.equal(revokedExpiry(after, months, NOW), expected);
    }
  }
});
