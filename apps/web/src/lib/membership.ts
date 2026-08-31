import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isPremiumMembership,
  isTrialUnstarted,
  membershipFromRow,
  trialExpiresAt,
  type Membership,
} from "@gongmoa/core";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 멤버십 조회·무료 기간 시작. 판정 규칙(만료·남은 일수)은 packages/core/membership.ts에
// 두고 웹·모바일이 공유한다. 여기는 조회와 쓰기만 담당한다.
//
// 쓰기는 전부 service_role로 한다: memberships는 select-own만 열려 있고 쓰기 정책이
// 없다. 클라이언트가 tier·expires_at을 직접 올릴 수 있으면 결제 없이 프리미엄이 된다.

const MEMBERSHIP_COLUMNS = "tier, source, started_at, expires_at";

// 무료 기간은 가입 순간부터 흐른다. 로그인 콜백에서 켜주지만(startTrialIfEligible),
// 콜백을 타지 않는 경로가 있다 — 앱에서 가입한 사람, 콜백 전에 이미 있던 계정,
// 배포 전에 가입한 사람. 그래서 조회할 때도 아직 안 켜졌으면 여기서 켠다.
//
// 매 조회마다 쓰기가 도는 건 아니다. started_at 이 null 인 계정은 처음 한 번뿐이고,
// 그 뒤로는 isTrialUnstarted 가 false 라 이 분기 자체를 지나가지 않는다. 체험을 거절당한
// 재가입자도 마찬가지다 — DB 함수가 거절하면서 started_at 을 찍어 두기 때문에 다음
// 조회부터는 여기 들어오지 않는다.
export async function getMembership(
  supabase: Supabase,
  userId: string,
): Promise<Membership> {
  const { data } = await supabase
    .from("memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  const membership = membershipFromRow(data ?? null);
  if (!isTrialUnstarted(membership)) return membership;

  // 행이 아예 없으면(트리거 이전 가입 등) 켤 대상이 없다 — membershipFromRow 가
  // 무료로 떨어뜨린 것이므로 UPDATE 가 0행이 되고, 지어낸 값을 돌려주면 안 된다.
  if (!data) return membership;

  // 켠 결과를 DB 가 돌려준 행으로 확인한다. 여기서 낙관적으로 "프리미엄"을 지어내면,
  // 쓰기가 실패했을 때 매 요청마다 같은 거짓말을 반복하며 유료 기능을 계속 열어준다.
  // 갱신된 행이 없으면(재가입자·쓰기 실패·경합) 방금 읽은 값을 그대로 쓴다.
  const started = await startTrialIfEligible(userId);
  return started ? membershipFromRow(started) : membership;
}

// 관리자는 멤버십과 무관하게 유료 기능을 다 쓴다. 검수·문의 대응을 하려면 사용자와
// 같은 화면을 볼 수 있어야 하고, 관리자 계정마다 결제나 체험을 붙이는 건 말이 안 된다.
// 판정은 admins 테이블(이메일 화이트리스트)을 보는 is_admin() — 이 테이블은 클라이언트가
// 직접 못 읽고 security definer 함수로만 검사된다.
export async function isAdminUser(supabase: Supabase): Promise<boolean> {
  const { data } = await supabase.rpc("is_admin");
  return data === true;
}

export async function isPremium(supabase: Supabase, userId: string): Promise<boolean> {
  if (await isAdminUser(supabase)) return true;
  return isPremiumMembership(await getMembership(supabase, userId));
}

export type MembershipRow = {
  tier: string | null;
  source: string | null;
  started_at: string | null;
  expires_at: string | null;
};

// 아직 무료 기간을 안 쓴 계정의 무료 기간을 켠다. 로그인 콜백과 getMembership 이
// 부른다 — 이벤트 안내가 "가입하는 순간부터"라서, 무언가를 하기 전에 이미 켜져
// 있어야 한다.
//
// 판정과 쓰기는 DB 함수 start_trial_if_eligible 하나가 한 트랜잭션으로 한다
// (supabase/schema.sql). 여기서 UPDATE 를 직접 날리지 말 것 — 그 함수는 "탈퇴 후
// 재가입인가"(trial_consumptions 원장)까지 함께 보는데, 웹과 앱이 각자 UPDATE 를
// 날리던 예전 구조로 돌아가면 한쪽만 검사하는 상태가 조용히 생긴다.
//
// 부가 처리이므로 실패해도 호출부를 막지 않는다 — 호출부에서 삼킨다.
// 실제로 켜졌을 때만 갱신된 행을 돌려준다(이미 켜졌거나·재가입자거나·실패면 null).
// 호출부가 "정말 켜졌는지"를 지어내지 않고 DB 가 돌려준 값으로 판단하게 하려는 것.
export async function startTrialIfEligible(
  userId: string,
): Promise<MembershipRow | null> {
  // 전면 무료 기간에는 그 종료일(FREE_UNTIL)까지, 끝난 뒤에는 예전처럼 60일.
  const expires = trialExpiresAt();

  const { data } = await createAdminClient().rpc("start_trial_if_eligible", {
    p_user_id: userId,
    p_expires_at: expires.toISOString(),
  });

  // setof 라 배열로 온다. 켜지지 않았으면 빈 배열이다.
  const row = Array.isArray(data) ? data[0] : data;
  return (row as MembershipRow | undefined) ?? null;
}
