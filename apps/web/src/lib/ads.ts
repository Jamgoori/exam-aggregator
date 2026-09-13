import "server-only";
import { cache } from "react";
import { isAdFreeMembership } from "@gongmoa/core";
import { createClient } from "@/lib/supabase/server";
import { getMembership, isAdminUser } from "@/lib/membership";
import { isAdsenseConfigured } from "@/lib/adsense";

// 이 방문자에게 광고를 띄울 것인가.
//
// 규칙: 비로그인과 무료 회원에게는 띄우고, 결제·출석 보상으로 기간을 들고 있는
// 사람과 관리자에게는 띄우지 않는다.
//
// **isPremiumMembership 을 쓰지 말 것.** 전면 무료 이벤트(FREE_UNTIL) 동안 로그인한
// 사람 전원에게 true 라, 그걸로 거르면 광고가 비로그인에게만 나간다. 판정은 기간의
// 출처를 보는 isAdFreeMembership 이 한다(packages/core/src/membership.ts).
//
// 관리자를 빼는 건 편의가 아니라 계정 보호다. 자기 사이트의 광고를 스스로 누르는
// 것은 애드센스의 무효 트래픽 정책 위반이고, 반복되면 계정이 정지된다. 배치를
// 눈으로 확인할 때는 로그아웃한 창(또는 시크릿 창)으로 볼 것.
//
// 비용: 비로그인 방문자(대부분의 트래픽)는 JWT 로컬 검증만 하고 DB 를 타지 않는다.
// 로그인 사용자에게만 is_admin() 과 memberships 조회가 붙는데, 둘 다 인덱스 한 번이고
// cache() 로 요청당 한 번만 돈다(한 페이지에 광고 자리가 둘이어도 조회는 한 번).
export const shouldShowAds = cache(async (): Promise<boolean> => {
  // 게시자 ID 가 없으면 애초에 광고가 붙지 않는다. 여기서 먼저 끊어야 심사 전
  // 배포에서 쓸데없는 조회가 돌지 않는다.
  if (!isAdsenseConfigured()) return false;

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return true;

  if (await isAdminUser(supabase)) return false;
  return !isAdFreeMembership(await getMembership(supabase, claims.sub));
});
