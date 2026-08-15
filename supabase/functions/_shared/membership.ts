// packages/core/src/membership.ts + 웹 src/lib/membership.ts 의 Deno 포팅본.
// 판정 규칙의 정본은 core 쪽이다 — TRIAL_DAYS를 바꿀 때는 양쪽을 함께 고칠 것.
// deno-lint-ignore-file no-explicit-any

// 출시 이벤트: 2달(60일) 무료. packages/core/src/membership.ts 와 반드시 같은 값.
export const TRIAL_DAYS = 60;

// 아직 무료 기간을 안 쓴 계정의 무료 기간을 켠다. 이벤트 안내가 "가입하는 순간부터"
// 라서, 무언가를 하기 전에 이미 켜져 있어야 한다 — 아래 isPremiumUser 와 채점 경로
// (status.ts)가 부른다.
//
// 판정과 쓰기는 DB 함수 start_trial_if_eligible 하나가 한 트랜잭션으로 한다
// (supabase/schema.sql). **여기서 memberships 를 직접 UPDATE 하지 말 것** — 그 함수는
// "탈퇴 후 재가입인가"(trial_consumptions 원장)까지 함께 보는데, 웹과 앱이 각자 UPDATE 를
// 날리던 예전 구조로 돌아가면 앱에서만 체험이 다시 켜지는 구멍이 조용히 생긴다.
//
// 실제로 켜졌을 때만 갱신된 행을 돌려준다(이미 켜졌거나·재가입자거나·실패면 null).
// 호출부가 "정말 켜졌는지"를 지어내지 않고 DB 가 돌려준 값으로 판단하게 하려는 것.
export async function startTrialIfEligible(admin: any, userId: string): Promise<any> {
  const expires = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

  const { data } = await admin.rpc("start_trial_if_eligible", {
    p_user_id: userId,
    p_expires_at: expires.toISOString(),
  });

  // setof 라 배열로 온다. 켜지지 않았으면 빈 배열이다.
  return (Array.isArray(data) ? data[0] : data) ?? null;
}

// 무료 회원이 하루에 해설을 열어볼 수 있는 문제지 수.
// 정본은 packages/core/src/membership.ts 의 FREE_EXPLANATION_DAILY_PAPERS —
// 바꿀 때는 반드시 양쪽을 함께 고칠 것(한쪽만 고치면 웹과 앱의 한도가 어긋난다).
export const FREE_EXPLANATION_DAILY_PAPERS = 3;

// 멤버십 판정. packages/core/src/membership.ts 의 isPremiumMembership + 웹
// src/lib/membership.ts 의 isPremium(관리자 우대 포함)을 합친 Deno 포팅본이다.
//
// 이게 없으면 웹에서만 페이월이 걸리고, 같은 계정으로 Edge Function 을 직접 부르면
// 오답노트·복습·진단·해설이 전부 열린다 — 화면을 막는 것과 API 를 막는 것은 다르다.
export async function isPremiumUser(
  admin: any,
  userId: string,
  email: string | null,
): Promise<boolean> {
  // 관리자는 멤버십과 무관하게 유료 기능을 쓴다(검수·문의 대응). admins 는 email 이
  // 기본키인 화이트리스트라(웹의 is_admin() 과 같은 기준) service_role 로만 확인한다.
  if (email) {
    const { data: adminRow } = await admin
      .from("admins")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    if (adminRow) return true;
  }

  const { data } = await admin
    .from("memberships")
    .select("tier, source, started_at, expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return false;

  // 무료 기간은 가입 순간부터다. 앱에서 가입한 사람은 웹 로그인 콜백을 타지 않으므로
  // 아직 안 켜져 있으면 여기서 켠다 — 안 그러면 앱 사용자만 첫 채점 전까지 잠긴다.
  // 처음 한 번뿐이고(started_at 이 채워지면 이 분기를 지나가지 않는다), 켠 직후에는
  // 방금 부여한 기간이 유효하므로 그대로 프리미엄이다.
  if (data.source === "trial" && data.started_at === null) {
    // 켠 결과를 DB 가 돌려준 행으로 확인한다. 무조건 true 를 돌려주면 쓰기가 실패했을
    // 때 매 요청마다 유료 기능이 열린다.
    const started = await startTrialIfEligible(admin, userId);
    return !!started;
  }

  if (data.tier !== "premium") return false;
  // expires_at 이 null 이면 만료 없음(정기결제 중).
  if (data.expires_at === null) return true;
  return new Date(data.expires_at).getTime() > Date.now();
}

// KST 달력 날짜(YYYY-MM-DD). 무료 일일 한도의 날짜 키 — 웹 lib/ai-diagnosis.ts 의
// kstToday() 와 같은 기준.
export function kstToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

// 무료 회원의 오늘 몫을 확인하고, 새 문제지면 오늘 목록에 올린다.
// 웹 lib/explanation-rate-limit.ts 의 consumeFreeDailyQuota 포팅본 — 같은 테이블
// (explanation_daily_views)을 쓰므로 웹에서 셋을 채웠으면 앱에서도 막힌다.
//
// 조회가 실패하면(스키마 미적용 등) 막지 않는다: 결제 유도 장치가 인프라 문제로
// 정상 사용자의 해설을 잠그는 쪽이 더 나쁘다.
export async function consumeFreeExplanationQuota(
  admin: any,
  userId: string,
  paperId: string,
): Promise<boolean> {
  const viewDate = kstToday();
  const { data, error } = await admin
    .from("explanation_daily_views")
    .select("paper_id")
    .eq("user_id", userId)
    .eq("view_date", viewDate);
  if (error) return true;

  const seen = data ?? [];
  // 오늘 이미 연 문제지는 한도를 깎지 않는다.
  if (seen.some((r: { paper_id: string }) => r.paper_id === paperId)) return true;
  if (seen.length >= FREE_EXPLANATION_DAILY_PAPERS) return false;

  await admin
    .from("explanation_daily_views")
    .upsert(
      { user_id: userId, view_date: viewDate, paper_id: paperId },
      { onConflict: "user_id,view_date,paper_id" },
    );
  return true;
}
