import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attendanceDaysLeft,
  FREE_MEMBERSHIP,
  isPremiumMembership,
  isTrialUnstarted,
  membershipFromRow,
  trialDaysLeft,
  type Membership,
} from "./membership";

const NOW = new Date("2026-03-10T00:00:00Z");

function trial(overrides: Partial<Membership> = {}): Membership {
  return {
    tier: "premium",
    source: "trial",
    startedAt: "2026-03-01T00:00:00Z",
    expiresAt: "2026-03-15T00:00:00Z",
    ...overrides,
  };
}

test("만료 전 체험은 프리미엄, 만료 후에는 무료로 떨어진다", () => {
  assert.equal(isPremiumMembership(trial(), NOW), true);
  assert.equal(
    isPremiumMembership(trial({ expiresAt: "2026-03-09T23:59:00Z" }), NOW),
    false,
  );
});

test("expires_at이 없으면 무기한(정기결제)", () => {
  assert.equal(
    isPremiumMembership({ tier: "premium", source: "paid", startedAt: null, expiresAt: null }, NOW),
    true,
  );
});

test("행이 없거나 free면 프리미엄 아님", () => {
  assert.equal(isPremiumMembership(null, NOW), false);
  assert.equal(isPremiumMembership(FREE_MEMBERSHIP, NOW), false);
  // tier가 free면 만료가 남아 있어도 프리미엄이 아니다(결제 취소 등).
  assert.equal(isPremiumMembership(trial({ tier: "free" }), NOW), false);
});

test("trialDaysLeft: 남은 일수 올림, 결제 회원은 null", () => {
  assert.equal(trialDaysLeft(trial(), NOW), 5);
  assert.equal(trialDaysLeft(trial({ expiresAt: "2026-03-10T00:00:01Z" }), NOW), 1);
  assert.equal(trialDaysLeft(trial({ expiresAt: "2026-03-01T00:00:00Z" }), NOW), 0);
  assert.equal(trialDaysLeft({ ...trial(), source: "paid" }, NOW), null);
});

test("attendanceDaysLeft: 출석 보상 기간만 세고, 체험·결제는 null", () => {
  // 같은 만료일이어도 출처가 다르면 다른 문구를 띄워야 한다 — 출석 보상을 체험으로
  // 부르면 끝난 체험이 되살아난 것처럼 보인다.
  assert.equal(attendanceDaysLeft({ ...trial(), source: "attendance" }, NOW), 5);
  assert.equal(attendanceDaysLeft(trial(), NOW), null);
  assert.equal(attendanceDaysLeft({ ...trial(), source: "paid" }, NOW), null);
  // 반대 방향도 막혀 있어야 한다.
  assert.equal(trialDaysLeft({ ...trial(), source: "attendance" }, NOW), null);
});

test("isTrialUnstarted: 첫 CBT 채점 때 체험을 켜줄 대상", () => {
  assert.equal(isTrialUnstarted(membershipFromRow({ tier: "free", source: "trial" })), true);
  assert.equal(isTrialUnstarted(trial()), false);
  assert.equal(isTrialUnstarted(null), false);
});

test("membershipFromRow: 모르는 값은 안전한 쪽(free/trial)으로", () => {
  assert.deepEqual(membershipFromRow(null), FREE_MEMBERSHIP);
  assert.deepEqual(membershipFromRow({ tier: "vip", source: "gift" }), FREE_MEMBERSHIP);
  assert.deepEqual(
    membershipFromRow({
      tier: "premium",
      source: "paid",
      started_at: "2026-03-01T00:00:00Z",
      expires_at: null,
    }),
    { tier: "premium", source: "paid", startedAt: "2026-03-01T00:00:00Z", expiresAt: null },
  );
});
