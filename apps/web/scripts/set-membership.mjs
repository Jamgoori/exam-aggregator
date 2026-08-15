// 계정 하나의 멤버십을 바꾼다 (운영/검수용).
//
//   npm run set-membership -- <이메일> free            # 무료 회원으로
//   npm run set-membership -- <이메일> premium 60      # 60일짜리 멤버십으로
//   npm run set-membership -- <이메일>                 # 현재 상태만 출력(쓰기 없음)
//
// memberships 는 쓰기 정책이 없는 테이블이라(결제 없이 프리미엄이 되는 걸 막기 위해)
// service_role 로만 바꿀 수 있다 — 그래서 화면이 아니라 이 스크립트로 한다.
//
// ⚠️ 이건 운영자가 손으로 상태를 바꾸는 도구지 "무료 체험을 켜는" 경로가 아니다.
// 체험 시작은 언제나 start_trial_if_eligible RPC 하나만 쓴다(AGENTS.md 금지선) —
// 그 함수가 탈퇴 후 재가입인지를 trial_consumptions 원장으로 함께 보기 때문이다.
// 그래서 여기서 premium 을 부여할 때는 source 를 'paid'(=결제·수동 부여)로 적는다.
// 'trial' 로 두면 체험 원장을 거치지 않은 기간이 체험처럼 남고, 화면에도
// "무료 체험 중 · N일 남음"으로 잘못 표시된다(trialDaysLeft 는 source='trial' 만 본다).
//
// free 로 내릴 때 started_at 을 반드시 남겨둔다: null 이면 getMembership 이
// "아직 체험을 안 쓴 계정"으로 보고 다음 접속 때 60일 체험을 다시 켜버린다
// (lib/membership.ts 의 isTrialUnstarted). 비어 있으면 지금 시각으로 채운다.
//
// 주의: admins 에 등록된 이메일은 멤버십과 무관하게 유료 기능이 전부 열린다
// (lib/membership.ts 의 isPremium). 그래서 등록 여부를 함께 알려준다.
import { createClient } from "@supabase/supabase-js";

const [email, tierArg, daysArg] = process.argv.slice(2);

if (!email) {
  console.error("사용법: node scripts/set-membership.mjs <이메일> [free|premium] [일수]");
  process.exit(1);
}
if (tierArg && tierArg !== "free" && tierArg !== "premium") {
  console.error(`tier 는 free 또는 premium 이어야 해요 (받은 값: ${tierArg})`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요해요.");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false } });

// auth.users 는 PostgREST 로 직접 못 읽어서 Admin API 로 훑는다.
async function findUserByEmail(target) {
  const wanted = target.toLowerCase();
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

const user = await findUserByEmail(email);
if (!user) {
  console.error(`계정을 찾지 못했어요: ${email}`);
  process.exit(1);
}

async function readMembership() {
  const { data, error } = await admin
    .from("memberships")
    .select("tier, source, started_at, expires_at, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const before = await readMembership();
console.log(`계정: ${user.email} (${user.id})`);
console.log("변경 전:", before ?? "(memberships 행 없음)");

const { data: adminRow } = await admin
  .from("admins")
  .select("email")
  .eq("email", user.email)
  .maybeSingle();
if (adminRow) {
  console.log(
    "⚠️  이 이메일은 admins 에 등록돼 있어요 — 멤버십을 무료로 내려도 관리자 우대로 유료 기능이 그대로 열립니다.",
  );
}

if (!tierArg) {
  console.log("(tier 인자가 없어 조회만 했어요 — 바꾸려면 free 또는 premium 을 붙이세요.)");
  process.exit(0);
}

const now = new Date();
const patch = {
  user_id: user.id,
  tier: tierArg,
  updated_at: now.toISOString(),
};

if (tierArg === "free") {
  // 체험이 다시 켜지지 않도록 started_at 을 반드시 채워 둔다(위 주석 참고).
  patch.started_at = before?.started_at ?? now.toISOString();
  if (!before?.started_at) {
    console.log(
      "ℹ️  started_at 이 비어 있어 지금 시각으로 채웁니다 — 이 계정은 앞으로 무료 체험을 받지 못합니다(체험을 쓴 것으로 남습니다).",
    );
  }
  // 만료 시각도 과거로 맞춘다 — 남겨두면 "체험 N일 남음" 안내가 계속 뜬다.
  patch.expires_at = now.toISOString();
} else {
  const days = Number(daysArg ?? 30);
  if (!Number.isFinite(days) || days <= 0) {
    console.error(`일수가 이상해요: ${daysArg}`);
    process.exit(1);
  }
  // 수동 부여는 체험이 아니다(위 주석) — 체험 원장을 거치지 않았으므로 'paid' 로 적는다.
  patch.source = "paid";
  patch.started_at = before?.started_at ?? now.toISOString();
  patch.expires_at = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

const { error } = await admin
  .from("memberships")
  .upsert(patch, { onConflict: "user_id" });
if (error) {
  console.error("변경 실패:", error.message);
  process.exit(1);
}

console.log("변경 후:", await readMembership());
