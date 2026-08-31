import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attendanceDaysLeft,
  FREE_UNTIL,
  isFreeForAll,
  trialExpiresAt,
  TRIAL_DAYS,
  FREE_MEMBERSHIP,
  isPremiumMembership,
  isTrialUnstarted,
  membershipDaysLeft,
  membershipFromRow,
  trialDaysLeft,
  type Membership,
} from "./membership";

// 기준 시각은 전면 무료 기간(FREE_UNTIL)이 끝난 뒤로 잡는다. 그 기간 안에서는
// 판정이 계정을 보지 않고 전부 프리미엄이라(isFreeForAll), 만료·잔여일 계산 자체를
// 시험할 수 없다. 기간 안의 동작은 아래 "전면 무료" 테스트들이 따로 본다.
const NOW = new Date("2027-08-10T00:00:00Z");

function trial(overrides: Partial<Membership> = {}): Membership {
  return {
    tier: "premium",
    source: "trial",
    startedAt: "2027-08-01T00:00:00Z",
    expiresAt: "2027-08-15T00:00:00Z",
    ...overrides,
  };
}

test("만료 전 체험은 프리미엄, 만료 후에는 무료로 떨어진다", () => {
  assert.equal(isPremiumMembership(trial(), NOW), true);
  assert.equal(
    isPremiumMembership(trial({ expiresAt: "2027-08-09T23:59:00Z" }), NOW),
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
  assert.equal(trialDaysLeft(trial({ expiresAt: "2027-08-10T00:00:01Z" }), NOW), 1);
  assert.equal(trialDaysLeft(trial({ expiresAt: "2027-08-01T00:00:00Z" }), NOW), 0);
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

test("membershipDaysLeft: 출처를 가리지 않는다", () => {
  assert.equal(membershipDaysLeft(trial(), NOW), 5);
  assert.equal(membershipDaysLeft({ ...trial(), source: "attendance" }, NOW), 5);
  assert.equal(membershipDaysLeft({ ...trial(), source: "paid" }, NOW), 5);
  // 만료 지난 체험 → 이미 free 로 떨어졌을 값이지만, tier 를 직접 premium 으로 두고
  // 만료만 지난 경우에도 0을 돌려준다(음수로 새지 않는다).
  assert.equal(
    membershipDaysLeft(trial({ expiresAt: "2027-08-01T00:00:00Z" }), NOW),
    0,
  );
});

test("membershipDaysLeft: 무료 회원이거나 만료 없는 정기결제면 null", () => {
  assert.equal(membershipDaysLeft(FREE_MEMBERSHIP, NOW), null);
  assert.equal(membershipDaysLeft(null, NOW), null);
  assert.equal(
    membershipDaysLeft(
      { tier: "premium", source: "paid", startedAt: "2027-01-01T00:00:00Z", expiresAt: null },
      NOW,
    ),
    null,
  );
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
      started_at: "2027-08-01T00:00:00Z",
      expires_at: null,
    }),
    { tier: "premium", source: "paid", startedAt: "2027-08-01T00:00:00Z", expiresAt: null },
  );
});

// ── 전면 무료 기간(FREE_UNTIL) ──────────────────────────────────────────────
// 이벤트 안내가 "27년 6월 30일까지 전면 무료"라, 그 마지막 날 밤까지는 계정이
// 무엇이든 열려 있어야 한다.
const IN_PROMO = new Date("2027-06-30T14:59:59+09:00");
const AFTER_PROMO = new Date(FREE_UNTIL);

test("전면 무료 기간에는 계정과 무관하게 모두 프리미엄", () => {
  assert.equal(isFreeForAll(IN_PROMO), true);
  assert.equal(isPremiumMembership(FREE_MEMBERSHIP, IN_PROMO), true);
  // 행이 없는 계정(트리거 이전 가입)도, 만료가 지난 체험도 마찬가지다.
  assert.equal(isPremiumMembership(null, IN_PROMO), true);
  assert.equal(isPremiumMembership(trial({ expiresAt: "2026-01-01T00:00:00Z" }), IN_PROMO), true);
});

test("6월 30일 자정(KST)에 끝난다 — 마지막 날은 통째로 무료", () => {
  // 6/30 23:59:59 KST = 아직 안이다.
  assert.equal(isFreeForAll(new Date("2027-06-30T23:59:59+09:00")), true);
  // 7/1 00:00:00 KST = 끝. 그 순간부터는 예전 규칙(행을 보고 판정).
  assert.equal(isFreeForAll(AFTER_PROMO), false);
  assert.equal(isPremiumMembership(FREE_MEMBERSHIP, AFTER_PROMO), false);
});

test("전면 무료 기간에는 남은 일수를 세지 않는다", () => {
  // "체험 N일 남음"·D-3 경고는 이 기간에 거짓 경보가 된다. 화면은 대신
  // FREE_UNTIL_LABEL 로 "언제까지 무료인지"를 직접 말한다.
  assert.equal(trialDaysLeft(trial(), IN_PROMO), null);
  assert.equal(attendanceDaysLeft({ ...trial(), source: "attendance" }, IN_PROMO), null);
  assert.equal(membershipDaysLeft(trial(), IN_PROMO), null);
});

test("trialExpiresAt: 기간 중에는 이벤트 종료일, 끝난 뒤에는 60일", () => {
  const promoEnd = new Date(FREE_UNTIL).getTime();
  assert.equal(trialExpiresAt(new Date("2026-09-01T00:00:00Z")).getTime(), promoEnd);
  // 종료 직전 가입자도 남은 며칠이 아니라 최소 60일을 받는다(둘 중 늦은 쪽).
  const lastWeek = new Date("2027-06-28T00:00:00+09:00");
  assert.equal(
    trialExpiresAt(lastWeek).getTime(),
    lastWeek.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  );
  const after = new Date("2027-08-01T00:00:00Z");
  assert.equal(
    trialExpiresAt(after).getTime(),
    after.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  );
});
