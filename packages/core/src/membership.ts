// 멤버십 판정 — 웹·모바일 공유(순수 계산).
//
// "오늘의 복습"(간격 반복 일정)·AI 약점 진단은 유료 전용이고, 해설은 무료 회원에게
// 하루 한도가 있다. 오답노트는 무료다 — 틀린 문항 모아보기도, 메모·다시 볼 문제
// 정리도, 섞어서 다시 풀기도. 전부 자기 데이터를 자기가 다시 보는 일이라 막지
// 않고, 그 안에서 문항 해설 본문만 유료로 둔다.
// 무료 기간은 계정당 한 번 주어지며 가입(첫 로그인) 순간부터 흐른다.
//
// 만료는 읽는 시점에 계산한다(크론 없음). expires_at이 지났으면 그 순간부터 free.
//
// 다만 지금은 **전면 무료 기간**(FREE_UNTIL)이다 — 그 시각까지는 위 규칙보다 앞서
// 모두가 프리미엄으로 판정된다. 아래 isFreeForAll 주석 참고.

// 출시 이벤트: 2달(60일) 무료. 이벤트가 끝나면 이 값을 되돌리면 되고, 그 시점에
// 이미 시작된 무료 기간은 memberships.expires_at 에 날짜가 박혀 있어 영향받지 않는다
// (만료는 읽는 시점에 expires_at 으로만 판정한다).
//
// 바꿀 때는 supabase/functions/_shared/membership.ts 의 TRIAL_DAYS 도 반드시 함께
// 고칠 것 — 한쪽만 고치면 웹으로 접속했을 때와 앱으로 접속했을 때 무료 기간이
// 달라진다(무료 기간을 켜는 UPDATE 가 양쪽에 하나씩 있다).
export const TRIAL_DAYS = 60;

// 전면 무료 기간(2027-06-30 까지, KST). 이 기간에는 **계정 상태와 무관하게 모두**
// 유료 기능을 쓴다 — 로그인만 하면 되고, 체험을 이미 소진했든 재가입자든 상관없다.
// 판정은 isFreeForAll() 하나가 하고, isPremiumMembership 이 맨 앞에서 그걸 본다.
//
// 값은 "끝나는 순간"(경계 제외)이다. 6월 30일 하루를 통째로 쓰게 하려면 7월 1일
// 0시(KST)가 되어야 한다 — 6월 30일 0시로 적으면 그날 아침에 이미 끊긴다.
//
// 기간이 끝나면 이 상수를 지우는 대신 과거 날짜로 두면 자동으로 예전(체험 60일)
// 규칙으로 돌아간다. 그때 이미 부여된 memberships.expires_at 은 날짜가 박혀 있어
// 영향받지 않는다(만료는 읽는 시점에 expires_at 으로만 판정한다).
//
// ⚠ 바꿀 때는 supabase/functions/_shared/membership.ts 의 FREE_UNTIL 도 반드시 함께
// 고칠 것 — 한쪽만 고치면 웹은 열려 있는데 앱·Edge Function 은 잠기는 상태가 된다.
export const FREE_UNTIL = "2027-07-01T00:00:00+09:00";

// 화면에 쓰는 표기. "언제까지"를 각 화면이 따로 적으면 상수만 바꾸고 문구는 옛 날짜를
// 계속 광고하게 된다.
export const FREE_UNTIL_LABEL = "2027년 6월 30일";

// 지금이 전면 무료 기간인가.
export function isFreeForAll(now: Date = new Date()): boolean {
  return now.getTime() < new Date(FREE_UNTIL).getTime();
}

// 무료 기간을 켤 때 박아 넣을 만료 시각. 전면 무료 기간에는 그 종료일까지 주고,
// 기간이 지난 뒤에는 예전처럼 가입 시점 + TRIAL_DAYS 다. 둘 중 늦은 쪽을 쓰므로
// 이벤트 막바지에 가입한 사람이 남은 며칠만 받고 끝나는 일이 없다.
export function trialExpiresAt(now: Date = new Date()): Date {
  const byDays = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const promoEnd = new Date(FREE_UNTIL);
  return promoEnd.getTime() > byDays.getTime() ? promoEnd : byDays;
}

// 무료 회원이 하루에 해설을 열어볼 수 있는 문제지 수. "문제지 3개"지 "3번"이 아니다 —
// 오늘 이미 연 문제지를 다시 여는 건 카운트하지 않는다. 보던 해설을 다시 보려다
// 한도가 깎이면, 아껴 쓰려고 탭을 못 닫는 이상한 사용법을 강요하게 된다.
//
// 하루의 경계는 AI 진단의 "일 1회"와 같은 KST 달력 날짜다. 사용자가 기억해야 할
// 하루 경계를 하나로 두려는 것.
export const FREE_EXPLANATION_DAILY_PAPERS = 3;

export type MembershipTier = "free" | "premium";

// 지금 열려 있는 기간이 어디서 왔는가.
//   trial      — 가입 시 주는 무료 기간.
//   paid       — 결제.
//   attendance — 출석 보상으로 받은 일수(attendance.ts).
//
// attendance 를 따로 두는 이유는 화면 문구 때문이다. 출석 보상을 trial 로 두면
// 체험이 끝난 무료 회원이 1일권을 받는 순간 "무료 체험 중 · 1일 남음"이 뜬다 —
// 끝난 체험이 되살아난 것처럼 보이고, D-3 복습 경고까지 다시 뜬다.
//
// 체험·구독이 아직 남아 있는 동안 받은 출석 일수는 source 를 바꾸지 않는다(그 기간의
// 성격이 이어지는 것이고, 체험 잔여 안내는 계속 맞아야 한다). 남은 기간이 없는
// 상태에서 받은 것만 attendance 다. 판정은 grant_attendance_membership 이 한다.
export type MembershipSource = "trial" | "paid" | "attendance";

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
  // 전면 무료 기간에는 계정을 따지지 않는다. 행이 없는 사용자(트리거 이전 가입)나
  // 체험을 이미 쓴 재가입자까지 한 번에 덮으려면 DB 값보다 먼저 봐야 한다.
  if (isFreeForAll(now)) return true;
  return hasOwnPremiumPeriod(membership, now);
}

// 계정 자체가 들고 있는 유효 기간이 살아 있는가 — 전면 무료 이벤트를 보지 않는다.
// isPremiumMembership 은 이벤트 기간에 누구에게나 true 라, "이 사람이 원래부터 기간을
// 갖고 있었나"를 물어야 하는 곳에서는 쓸 수 없다. 지금은 결제 계산(payment.ts)이 쓴다:
// 이벤트 때문에 true 가 나오면 무료 회원의 결제가 "무기한 계정에 이어 붙이기"로
// 오인돼 만료 없는 멤버십이 나간다.
export function hasOwnPremiumPeriod(
  membership: Membership | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!membership || membership.tier !== "premium") return false;
  if (membership.expiresAt === null) return true;
  return new Date(membership.expiresAt).getTime() > now.getTime();
}

// 광고를 빼줄 자격이 있는가 — 비로그인·무료 회원에게만 광고를 띄우기 위한 판정.
//
// isPremiumMembership 도 hasOwnPremiumPeriod 도 여기서는 쓸 수 없다. 둘 다 지금
// 로그인한 사람 거의 전부에게 true 를 준다. 앞의 것은 전면 무료 이벤트를 보고,
// 뒤의 것은 가입할 때 켜지는 체험을 보는데 그 체험의 만료가 trialExpiresAt 때문에
// FREE_UNTIL 까지 박혀 있다. 둘 중 아무거나 쓰면 "무료 회원에게도 광고"가 조용히
// "비로그인에게만 광고"로 바뀐다 — 화면상 차이가 없어서 알아채기도 어렵다.
//
// 그래서 남은 기간이 아니라 그 기간의 **출처**(source)를 본다. 광고를 빼주는 쪽은
// 둘뿐이다:
//   paid       — 결제. 광고 없는 화면은 그 대가의 일부다.
//   attendance — 출석 보상으로 받은 일수. 보상으로 유료 기능을 열어주면서 광고만
//                그대로 두면 보상이 초라해진다.
// trial(가입 체험)은 일부러 뺐다. 지금은 가입자 전원이 들고 있어서, 넣는 순간 이
// 판정이 "로그인했는가"와 같은 말이 된다.
//
// 관리자는 여기서 보지 않는다 — 멤버십 행과 무관한 별도 판정(is_admin)이라 부르는
// 쪽이 함께 본다(apps/web/src/lib/ads.ts).
export function isAdFreeMembership(
  membership: Membership | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!membership) return false;
  if (membership.source !== "paid" && membership.source !== "attendance") {
    return false;
  }
  return hasOwnPremiumPeriod(membership, now);
}

// 만료까지 남은 일수(올림). 만료가 없으면 null. source 를 주면 그 출처일 때만 계산한다
// (trialDaysLeft·attendanceDaysLeft 처럼 "이 화면은 체험/보상일 때만 말한다"는 쪽).
// source 를 생략하면 출처를 가리지 않는다 — 결제든 체험이든 출석 보상이든, 지금 열려
// 있는 기간이 며칠 남았는지만 궁금한 화면(마이페이지 헤더 배지 등)이 쓴다.
function expiryDaysLeft(
  membership: Membership | null | undefined,
  now: Date,
  source?: MembershipSource,
): number | null {
  // 전면 무료 기간에는 "N일 남음"을 말하지 않는다. 만료가 300일 뒤라 남은 일수를
  // 세어봐야 의미가 없고, D-3 경고 같은 문구는 거짓 경보가 된다. 대신 화면은
  // FREE_UNTIL_LABEL 로 "언제까지 무료인지"를 직접 말한다.
  if (isFreeForAll(now)) return null;
  if (!membership) return null;
  if (source && membership.source !== source) return null;
  if (!membership.expiresAt) return null;
  const ms = new Date(membership.expiresAt).getTime() - now.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

// 체험 만료까지 남은 일수(올림). 체험이 아니거나 만료가 없으면 null.
// 만료 D-3 배너처럼 "곧 끊긴다"를 알리는 화면에서 쓴다.
export function trialDaysLeft(
  membership: Membership | null | undefined,
  now: Date = new Date(),
): number | null {
  return expiryDaysLeft(membership, now, "trial");
}

// 출석 보상으로 열린 기간의 남은 일수(올림). 그 출처가 아니면 null.
// "무료 체험"이 아니라 "출석 보상"이라고 말해야 하는 화면에서 쓴다.
export function attendanceDaysLeft(
  membership: Membership | null | undefined,
  now: Date = new Date(),
): number | null {
  return expiryDaysLeft(membership, now, "attendance");
}

// 지금 열려 있는 멤버십 기간의 남은 일수(올림) — 출처(체험·결제·출석 보상)를 가리지
// 않는다. 무료 회원이거나(에초에 premium 이 아니거나) 만료 없는 프리미엄(정기결제)이면
// null. "얼마 남았는지"만 한 줄로 보여주는 화면(마이페이지 헤더 배지)이 쓰고, "왜
// 남았는지"까지 말해야 하는 화면은 위 두 함수를 따로 쓴다.
export function membershipDaysLeft(
  membership: Membership | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!membership || membership.tier !== "premium") return null;
  return expiryDaysLeft(membership, now);
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
    source:
      row.source === "paid" || row.source === "attendance" ? row.source : "trial",
    startedAt: row.started_at ?? null,
    expiresAt: row.expires_at ?? null,
  };
}
