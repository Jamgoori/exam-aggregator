import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPremiumMembership, type Membership } from "@gongmoa/core";
import {
  getMembership as getMembershipRule,
  startTrialIfEligible as startTrialIfEligibleRule,
  type MembershipRow,
} from "@gongmoa/core/server";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type { MembershipRow };

// 멤버십 조회·무료 기간 시작의 웹 어댑터. 판정 규칙(만료·남은 일수)은
// packages/core/membership.ts, 조회·쓰기 본문은 packages/core/src/rules/membership-server.ts
// 에 있고 Edge Function(membership-get·explanations-get·ai-diagnose)도 번들로 같은 함수를
// 부른다. 여기는 세션 클라이언트와 service_role 클라이언트를 넘기는 일만 한다.
//
// 쓰기는 전부 service_role로 한다: memberships는 select-own만 열려 있고 쓰기 정책이
// 없다. 클라이언트가 tier·expires_at을 직접 올릴 수 있으면 결제 없이 프리미엄이 된다.

// 무료 기간은 가입 순간부터 흐른다. 로그인 콜백에서 켜주지만(startTrialIfEligible),
// 콜백을 타지 않는 경로가 있다 — 그래서 조회할 때도 아직 안 켜졌으면 규칙 쪽이 켠다.
// admin 클라이언트는 켜야 할 때만 만든다(started_at 이 null 인 계정은 처음 한 번뿐이다).
export async function getMembership(
  supabase: Supabase,
  userId: string,
): Promise<Membership> {
  return getMembershipRule(supabase, userId, () => createAdminClient());
}

// 관리자는 멤버십과 무관하게 유료 기능을 다 쓴다. 검수·문의 대응을 하려면 사용자와
// 같은 화면을 볼 수 있어야 하고, 관리자 계정마다 결제나 체험을 붙이는 건 말이 안 된다.
// 판정은 admins 테이블(이메일 화이트리스트)을 보는 is_admin() — 이 테이블은 클라이언트가
// 직접 못 읽고 security definer 함수로만 검사된다. (Edge 는 JWT 의 email 로 같은 테이블을
// service_role 조회한다 — core 의 isAdminEmail.)
export async function isAdminUser(supabase: Supabase): Promise<boolean> {
  const { data } = await supabase.rpc("is_admin");
  return data === true;
}

export async function isPremium(supabase: Supabase, userId: string): Promise<boolean> {
  if (await isAdminUser(supabase)) return true;
  return isPremiumMembership(await getMembership(supabase, userId));
}

// 아직 무료 기간을 안 쓴 계정의 무료 기간을 켠다. 로그인 콜백과 getMembership 이
// 부른다. 판정과 쓰기는 DB 함수 start_trial_if_eligible 하나가 한다 — 여기서 UPDATE 를
// 직접 날리지 말 것(AGENTS.md 금지선). 실제로 켜졌을 때만 갱신된 행을 돌려준다.
export async function startTrialIfEligible(
  userId: string,
): Promise<MembershipRow | null> {
  return startTrialIfEligibleRule(createAdminClient(), userId);
}
