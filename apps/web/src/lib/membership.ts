import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isPremiumMembership,
  membershipFromRow,
  TRIAL_DAYS,
  type Membership,
} from "@gongmoa/core";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 멤버십 조회·체험 시작. 판정 규칙(만료·남은 일수)은 packages/core/membership.ts에
// 두고 웹·모바일이 공유한다. 여기는 조회와 쓰기만 담당한다.
//
// 쓰기는 전부 service_role로 한다: memberships는 select-own만 열려 있고 쓰기 정책이
// 없다. 클라이언트가 tier·expires_at을 직접 올릴 수 있으면 결제 없이 프리미엄이 된다.

const MEMBERSHIP_COLUMNS = "tier, source, started_at, expires_at";

export async function getMembership(
  supabase: Supabase,
  userId: string,
): Promise<Membership> {
  const { data } = await supabase
    .from("memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  return membershipFromRow(data ?? null);
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

// 아직 체험을 안 쓴 사용자의 체험을 켠다. 첫 CBT 채점에서만 부른다 — 가입 직후엔
// 오답이 0개라 복습 큐가 비어 있어서, 가입일 기준으로 재면 체험 앞부분을 오답 쌓는
// 데 다 쓰게 된다.
//
// started_at is null 을 조건에 건 단일 UPDATE라 동시 채점이 겹쳐도 체험이 두 번
// 시작되지 않는다(두 번째 UPDATE는 0행 갱신).
//
// 부가 처리이므로 실패해도 채점을 막지 않는다 — 호출부에서 삼킨다.
export async function startTrialIfEligible(userId: string): Promise<void> {
  const now = new Date();
  const expires = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  await createAdminClient()
    .from("memberships")
    .update({
      tier: "premium",
      started_at: now.toISOString(),
      expires_at: expires.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("user_id", userId)
    .eq("source", "trial")
    .is("started_at", null);
}
