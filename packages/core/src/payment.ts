// 결제 → 멤버십 기간 계산 — 웹·모바일 공유(순수 계산).
//
// 결제 자체(PG 호출·승인)는 각 앱의 서버가 하고, "그래서 만료일이 언제가 되는가"는
// 여기 하나에서만 정한다. 부여(결제 성공)와 회수(취소·환불)가 서로의 역이어야 하는데,
// 두 계산이 다른 파일에 흩어져 있으면 환불했는데 멤버십이 안 끊기거나(손해) 남은
// 체험 기간까지 같이 날아가는(항의) 쪽으로 조용히 어긋난다.

import { isPremiumMembership, type Membership } from "./membership";

// payments.status 의 정본. DB 의 check 제약(supabase/schema.sql)과 반드시 같은 집합.
//   ready    — 주문만 만들어 둔 상태. 결제창을 띄우기 전.
//   paid     — PG 승인 완료. 멤버십 기간이 부여된 상태.
//   failed   — 사용자가 창을 닫았거나 카드사에서 거절됨.
//   canceled — 승인 뒤 전액 취소(환불)됨. 부여했던 기간을 회수한 상태.
export const PAYMENT_STATUSES = ["ready", "paid", "failed", "canceled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// 달을 더한다. 말일 처리는 "넘치지 않게 그 달의 마지막 날로 자른다" — 1월 31일에
// 1개월을 더하면 3월 3일이 아니라 2월 28일이다. JS 의 setMonth 는 넘치는 날짜를
// 다음 달로 굴려버려서, 1개월권을 산 사람이 31일에 결제하면 하루를 더 받는다.
//
// 계산은 UTC 로 한다. 한국은 서머타임이 없어 오프셋이 +9 로 고정이라, UTC 로 달을
// 더해도 KST 기준 시:분이 그대로 보존된다(8/14 20:00 KST → 9/14 20:00 KST).
export function addMonths(base: Date, months: number): Date {
  const day = base.getUTCDate();
  // 일(day)을 1로 고정한 채 달을 옮긴 뒤에 날짜를 되돌린다. 1일은 어느 달에도
  // 존재하므로 옮기는 도중에 굴러넘칠 일이 없다.
  const moved = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth() + months,
      1,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
  // 옮겨간 달의 마지막 날(다음 달 0일 = 이번 달 말일).
  const lastDay = new Date(
    Date.UTC(moved.getUTCFullYear(), moved.getUTCMonth() + 1, 0),
  ).getUTCDate();
  moved.setUTCDate(Math.min(day, lastDay));
  return moved;
}

// 결제 성공 시의 새 만료 시각(ISO). 남은 기간이 있으면 거기에 이어 붙인다.
//
// 이어 붙이는 게 핵심이다: 무료 체험이 20일 남은 사람이 1년권을 사면 385일이 되어야
// 한다. "지금부터 12개월"로 덮어쓰면 결제하는 순간 남은 체험 20일이 사라진다 —
// 일찍 결제할수록 손해라서, 사람들은 체험 마지막 날까지 기다렸다가 결제하게 된다.
//
// 만료가 없는 프리미엄(expiresAt === null, 무기한)에는 손대지 않는다. 여기에 날짜를
// 박으면 무기한이던 계정이 유한해진다 — 늘리려고 한 결제가 오히려 뺏는 셈이 된다.
export function grantedExpiry(
  membership: Membership | null | undefined,
  months: number,
  now: Date = new Date(),
): string | null {
  if (membership && isPremiumMembership(membership, now) && membership.expiresAt === null) {
    return null;
  }
  const current =
    membership && isPremiumMembership(membership, now) && membership.expiresAt
      ? new Date(membership.expiresAt)
      : null;
  // 이미 지난 만료일에 이어 붙이면 안 된다(isPremiumMembership 이 걸러주지만,
  // 만료 직전에 결제한 요청이 승인까지 몇 초 걸려 그 사이에 만료되는 경우가 있다).
  const base = current && current.getTime() > now.getTime() ? current : now;
  return addMonths(base, months).toISOString();
}

// 전액 취소(환불) 시 되돌릴 만료 시각(ISO). 부여할 때 더한 개월 수를 그대로 뺀다.
//
// grantedExpiry 의 역이다. 체험이 20일 남은 상태에서 1년권을 샀다가 환불하면
// (385일 - 12개월) = 20일이 남아, 결제 전 상태로 정확히 돌아간다. 이미 다 쓴
// 경우처럼 결과가 과거가 되면 지금 시각으로 자른다 — 만료를 과거로 박아두면
// "언제 끊겼는지"가 실제와 달라져 문의 대응 때 사실을 못 찾는다.
export function revokedExpiry(
  membership: Membership | null | undefined,
  months: number,
  now: Date = new Date(),
): string {
  // 만료가 없던(무기한) 계정은 뺄 기준이 없다. 환불했으므로 지금 끊는다.
  if (!membership?.expiresAt) return now.toISOString();
  const reverted = addMonths(new Date(membership.expiresAt), -months);
  return reverted.getTime() > now.getTime() ? reverted.toISOString() : now.toISOString();
}
