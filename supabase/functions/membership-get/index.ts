// 멤버십 조회(설계서 §6.7 #1). 웹 lib/membership.ts#getMembership/isPremium 과 auth/callback
// 의 체험 시작을 앱이 한 번에 받는 진입점 — 규칙 본문은 packages/core/src/rules/
// membership-server.ts(웹과 같은 함수).
//
//   {} → { membership: Membership, isAdmin: boolean, isPremium: boolean }
//
// isTrialUnstarted(가입 후 아직 무료 기간을 안 켠 계정)면 getMembership 이 안에서
// start_trial_if_eligible RPC 로 켠다(memberships 직접 UPDATE 금지 — AGENTS.md 금지선).
// 앱은 로그인 직후·포그라운드마다 이 함수를 불러 같은 경로로 체험을 켠다(§6.6 "체험 시작").
//
// isPremium 은 관리자 우대·전면 무료 기간을 포함한 최종 판정이고, membership 은 계정이
// 들고 있는 기간 그대로다(화면이 "언제까지"를 그리는 데 쓴다). isAdmin 은 admins 이메일
// 화이트리스트(웹 is_admin() 과 같은 기준).
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import { getMembership, isAdminEmail, isPremiumMembership } from "../_shared/core.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const admin = coreAdmin();
  const [membership, isAdmin] = await Promise.all([
    getMembership(admin, auth.userId),
    isAdminEmail(admin, auth.email),
  ]);

  return json({
    membership,
    isAdmin,
    isPremium: isAdmin || isPremiumMembership(membership),
  });
});
