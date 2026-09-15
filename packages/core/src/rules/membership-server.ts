import type { SupabaseClient } from "@supabase/supabase-js";
import { kstDayKey } from "../format";
import {
  FREE_EXPLANATION_DAILY_PAPERS,
  isFreeForAll,
  isPremiumMembership,
  isTrialUnstarted,
  membershipFromRow,
  trialExpiresAt,
  type Membership,
} from "../membership";

// 멤버십 조회·무료 기간 시작 — 웹 서버 액션과 Edge Function 이 함께 쓰는 서버 규칙.
// 판정 규칙(만료·남은 일수·상수)은 ../membership.ts 에 두고 웹·모바일이 공유한다.
// 여기는 조회와 쓰기만 담당한다.
//
// (예전에는 웹 apps/web/src/lib/membership.ts 와 Edge _shared/membership.ts 가 같은 규칙을
//  한 벌씩 들고 있어 TRIAL_DAYS·FREE_UNTIL 을 양쪽에서 함께 고쳐야 했다. 지금은 이 파일
//  하나를 웹은 직접 import 하고 Edge 는 esbuild 번들(_shared/core.mjs)로 받는다.)
//
// 쓰기는 전부 service_role로 한다: memberships는 select-own만 열려 있고 쓰기 정책이
// 없다. 클라이언트가 tier·expires_at을 직접 올릴 수 있으면 결제 없이 프리미엄이 된다.

const MEMBERSHIP_COLUMNS = "tier, source, started_at, expires_at";

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
  admin: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<MembershipRow | null> {
  // 전면 무료 기간에는 그 종료일(FREE_UNTIL)까지, 끝난 뒤에는 예전처럼 60일.
  const expires = trialExpiresAt(now);

  const { data } = await admin.rpc("start_trial_if_eligible", {
    p_user_id: userId,
    p_expires_at: expires.toISOString(),
  });

  // setof 라 배열로 온다. 켜지지 않았으면 빈 배열이다.
  const row = Array.isArray(data) ? data[0] : data;
  return (row as MembershipRow | undefined) ?? null;
}

// 무료 기간은 가입 순간부터 흐른다. 로그인 콜백에서 켜주지만(startTrialIfEligible),
// 콜백을 타지 않는 경로가 있다 — 앱에서 가입한 사람, 콜백 전에 이미 있던 계정,
// 배포 전에 가입한 사람. 그래서 조회할 때도 아직 안 켜졌으면 여기서 켠다.
//
// 매 조회마다 쓰기가 도는 건 아니다. started_at 이 null 인 계정은 처음 한 번뿐이고,
// 그 뒤로는 isTrialUnstarted 가 false 라 이 분기 자체를 지나가지 않는다. 체험을 거절당한
// 재가입자도 마찬가지다 — DB 함수가 거절하면서 started_at 을 찍어 두기 때문에 다음
// 조회부터는 여기 들어오지 않는다.
//
// client 는 본인 행을 읽을 수 있으면 된다(웹은 사용자 세션 클라이언트, Edge 는 admin).
// 켜는 쓰기는 service_role 이 필요하므로 getAdmin 으로 따로 받는다 — 지연 생성인 이유는
// 이 함수가 레이아웃마다 불리는데 켜야 하는 계정은 드물어, 매번 admin 클라이언트를 만들
// 필요가 없어서다. 생략하면 client 를 그대로 쓴다(Edge 처럼 client 가 이미 admin 일 때).
export async function getMembership(
  client: SupabaseClient,
  userId: string,
  getAdmin: () => SupabaseClient = () => client,
): Promise<Membership> {
  const { data } = await client
    .from("memberships")
    .select(MEMBERSHIP_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  const membership = membershipFromRow((data as MembershipRow | null) ?? null);
  if (!isTrialUnstarted(membership)) return membership;

  // 행이 아예 없으면(트리거 이전 가입 등) 켤 대상이 없다 — membershipFromRow 가
  // 무료로 떨어뜨린 것이므로 UPDATE 가 0행이 되고, 지어낸 값을 돌려주면 안 된다.
  if (!data) return membership;

  // 켠 결과를 DB 가 돌려준 행으로 확인한다. 여기서 낙관적으로 "프리미엄"을 지어내면,
  // 쓰기가 실패했을 때 매 요청마다 같은 거짓말을 반복하며 유료 기능을 계속 열어준다.
  // 갱신된 행이 없으면(재가입자·쓰기 실패·경합) 방금 읽은 값을 그대로 쓴다.
  const started = await startTrialIfEligible(getAdmin(), userId);
  return started ? membershipFromRow(started) : membership;
}

// 관리자 판정(이메일 화이트리스트). admins 는 email 이 기본키라(웹의 is_admin() 도 JWT 의
// email 로 검사한다) service_role 로만 읽는다 — 이 테이블은 클라이언트가 직접 못 읽는다.
// 웹 서버 컴포넌트는 세션 클라이언트로 rpc("is_admin") 을 부르는 편이 한 번의 왕복으로
// 끝나 그쪽(apps/web/src/lib/membership.ts#isAdminUser)을 그대로 쓰고, Edge 처럼 JWT 의
// email 만 손에 있는 곳이 이 함수를 쓴다.
export async function isAdminEmail(
  admin: SupabaseClient,
  email: string | null | undefined,
): Promise<boolean> {
  if (!email) return false;
  const { data } = await admin
    .from("admins")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  return !!data;
}

// 멤버십 판정 — 관리자 우대 포함. ../membership.ts 의 isPremiumMembership(전면 무료
// 기간 → 계정 기간 순)에 "관리자는 멤버십과 무관하게 유료 기능을 다 쓴다"(검수·문의
// 대응)를 얹은 것.
//
// 이게 없으면 웹에서만 페이월이 걸리고, 같은 계정으로 Edge Function 을 직접 부르면
// 진단·해설이 열린다 — 화면을 막는 것과 API 를 막는 것은 다르다.
// (오답노트와 섞어풀기는 무료라 여기 해당하지 않는다.)
export async function isPremiumUserFor(
  admin: SupabaseClient,
  user: { userId: string; email: string | null },
  now: Date = new Date(),
): Promise<boolean> {
  // 전면 무료 기간에는 계정을 따지지 않는다 — 조회조차 하지 않고 연다. 체험을 이미
  // 쓴 재가입자·행이 없는 옛 계정까지 웹과 똑같이 열려야 하기 때문이다
  // (isPremiumMembership 과 같은 자리에 같은 검사가 있다).
  if (isFreeForAll(now)) return true;
  if (await isAdminEmail(admin, user.email)) return true;
  // 무료 기간은 가입 순간부터다. 앱에서 가입한 사람은 웹 로그인 콜백을 타지 않으므로
  // 아직 안 켜져 있으면 getMembership 이 여기서 켠다 — 안 그러면 앱 사용자만 첫 채점
  // 전까지 잠긴다. 켠 직후에는 방금 부여한 기간이 유효하므로 그대로 프리미엄이다.
  return isPremiumMembership(await getMembership(admin, user.userId), now);
}

// KST 달력 날짜(YYYY-MM-DD). 무료 일일 한도·AI 진단 "일 1회"·출석이 같은 하루 경계를
// 쓴다 — 사용자가 기억해야 할 하루 경계를 서비스 전체에서 하나로 두려는 것.
export function kstToday(now: Date = new Date()): string {
  return kstDayKey(now);
}

export type FreeExplanationQuota = {
  // 이 문제지의 해설을 내줘도 되는가.
  allowed: boolean;
  // 이번 요청을 반영한 오늘 잔여 문제지 수. 조회 실패로 통과시킨 경우엔 모르므로 null.
  remainingToday: number | null;
};

// 무료 회원의 오늘 몫을 확인하고, 새 문제지면 오늘 목록에 올린다.
//
// explanation_daily_views 는 (user_id, view_date, paper_id)가 기본키라 같은 문제지를
// 몇 번 열어도 행이 하나뿐이다. 그래서 하루치 조회가 최대 세 행으로 끝나고, "오늘 이미
// 본 문제지인가"가 그냥 목록 포함 여부가 된다. 같은 테이블을 웹·앱이 쓰므로 웹에서
// 셋을 채웠으면 앱에서도 막힌다.
//
// 조회가 실패하면(스키마 미적용 등) 막지 않고 통과시킨다. 결제 유도 장치가 인프라
// 문제로 정상 사용자의 해설을 잠그는 쪽이, 잠깐 한도가 안 걸리는 쪽보다 나쁘다.
// (그때는 잔여 수를 모르므로 remainingToday 는 null 이다.)
export async function consumeFreeExplanationQuota(
  admin: SupabaseClient,
  userId: string,
  paperId: string,
  now: Date = new Date(),
): Promise<FreeExplanationQuota> {
  const viewDate = kstToday(now);

  const { data, error } = await admin
    .from("explanation_daily_views")
    .select("paper_id")
    .eq("user_id", userId)
    .eq("view_date", viewDate);

  if (error) return { allowed: true, remainingToday: null };

  const seen = (data ?? []) as { paper_id: string }[];
  const remainingAfter = (used: number) =>
    Math.max(0, FREE_EXPLANATION_DAILY_PAPERS - used);

  // 오늘 이미 연 문제지 — 한도를 깎지 않는다.
  if (seen.some((r) => r.paper_id === paperId)) {
    return { allowed: true, remainingToday: remainingAfter(seen.length) };
  }

  if (seen.length >= FREE_EXPLANATION_DAILY_PAPERS) {
    return { allowed: false, remainingToday: 0 };
  }

  // 동시에 두 문제지를 열면 둘 다 통과할 수 있지만(읽고 쓰는 사이의 경합), 하루
  // 한 개 더 열리는 정도라 잠금을 걸어가며 막을 값이 아니다.
  await admin
    .from("explanation_daily_views")
    .upsert(
      { user_id: userId, view_date: viewDate, paper_id: paperId },
      { onConflict: "user_id,view_date,paper_id" },
    );

  return { allowed: true, remainingToday: remainingAfter(seen.length + 1) };
}
