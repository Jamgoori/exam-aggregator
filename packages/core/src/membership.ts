// 멤버십 판정 — 웹·모바일 공유(순수 계산).
//
// 복습(간격 반복)·AI 약점 진단은 유료 전용이고, 해설은 무료 회원에게 하루 한도가
// 있다. 오답노트는 열람 자체(틀린 문항 모아보기)가 무료이고 그 안의 해설 본문과
// 정리 도구(메모·다시 볼 문제)만 유료다 — 내가 틀린 문제 목록은 내 데이터라
// 막지 않는다. 무료 기간은 계정당 한 번 주어지며 가입(첫 로그인) 순간부터 흐른다.
//
// 만료는 읽는 시점에 계산한다(크론 없음). expires_at이 지났으면 그 순간부터 free.

// 출시 이벤트: 2달(60일) 무료. 이벤트가 끝나면 이 값을 되돌리면 되고, 그 시점에
// 이미 시작된 무료 기간은 memberships.expires_at 에 날짜가 박혀 있어 영향받지 않는다
// (만료는 읽는 시점에 expires_at 으로만 판정한다).
//
// 바꿀 때는 supabase/functions/_shared/membership.ts 의 TRIAL_DAYS 도 반드시 함께
// 고칠 것 — 한쪽만 고치면 웹으로 접속했을 때와 앱으로 접속했을 때 무료 기간이
// 달라진다(무료 기간을 켜는 UPDATE 가 양쪽에 하나씩 있다).
export const TRIAL_DAYS = 60;

// 무료 회원이 하루에 해설을 열어볼 수 있는 문제지 수. "문제지 3개"지 "3번"이 아니다 —
// 오늘 이미 연 문제지를 다시 여는 건 카운트하지 않는다. 보던 해설을 다시 보려다
// 한도가 깎이면, 아껴 쓰려고 탭을 못 닫는 이상한 사용법을 강요하게 된다.
//
// 하루의 경계는 AI 진단의 "일 1회"와 같은 KST 달력 날짜다. 사용자가 기억해야 할
// 하루 경계를 하나로 두려는 것.
export const FREE_EXPLANATION_DAILY_PAPERS = 3;

export type MembershipTier = "free" | "premium";
export type MembershipSource = "trial" | "paid";

export type Membership = {
  tier: MembershipTier;
  source: MembershipSource;
  // null이면 아직 무료 기간이 시작되지 않았다(가입 후 첫 조회 때 채워진다).
  startedAt: string | null;
  // null이면 만료 없음(정기결제 중).
  expiresAt: string | null;
};

// 행이 없는 사용자(트리거 이전에 가입 등)는 무료로 본다.
export const FREE_MEMBERSHIP: Membership = {
  tier: "free",
  source: "trial",
  startedAt: null,
  expiresAt: null,
};

export function isPremiumMembership(
  membership: Membership | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!membership || membership.tier !== "premium") return false;
  if (membership.expiresAt === null) return true;
  return new Date(membership.expiresAt).getTime() > now.getTime();
}

// 체험 만료까지 남은 일수(올림). 체험이 아니거나 만료가 없으면 null.
// 만료 D-3 배너처럼 "곧 끊긴다"를 알리는 화면에서 쓴다.
export function trialDaysLeft(
  membership: Membership | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!membership || membership.source !== "trial" || !membership.expiresAt) return null;
  const ms = new Date(membership.expiresAt).getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// 아직 무료 기간을 쓰지 않은 사용자인지(= 지금 켜줄 대상).
export function isTrialUnstarted(membership: Membership | null | undefined): boolean {
  return membership?.source === "trial" && membership.startedAt === null;
}

// DB 행 → Membership. 컬럼이 비어 있으면 무료로 떨어뜨린다(마이그레이션 전 대비).
export function membershipFromRow(
  row: {
    tier?: string | null;
    source?: string | null;
    started_at?: string | null;
    expires_at?: string | null;
  } | null,
): Membership {
  if (!row) return FREE_MEMBERSHIP;
  return {
    tier: row.tier === "premium" ? "premium" : "free",
    source: row.source === "paid" ? "paid" : "trial",
    startedAt: row.started_at ?? null,
    expiresAt: row.expires_at ?? null,
  };
}
