import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { startTrialIfEligible } from "@/lib/membership";

// 소셜 로그인(구글·카카오)이 끝나면 provider가 이 경로로 ?code=...를 붙여서 돌려보낸다.
// 여기서 code를 세션으로 교환해 쿠키에 심어야 로그인 상태가 된다. code 교환은 PKCE
// 검증(로그인을 시작한 브라우저의 code_verifier 쿠키 대조)을 통과해야 하므로, 탈취된
// code를 다른 브라우저에서 재사용하는 공격은 여기서 실패한다.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = sanitizeNextPath(url.searchParams.get("next"));

  // 사용자가 provider 동의 화면에서 취소하는 등 provider가 에러로 돌려보낸 경우.
  // error_description은 provider가 주는 외부 입력이라 그대로 노출하지 않는다.
  if (url.searchParams.get("error")) {
    return NextResponse.redirect(
      new URL(
        `/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent("로그인이 취소됐거나 실패했어요")}`,
        url.origin,
      ),
    );
  }

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // 무료 기간은 "가입하는 순간부터"다. 가입은 첫 소셜 로그인과 같은 사건이라
      // 이 콜백이 유일하게 확실한 지점 — 여기서 켜지 않으면 첫 화면을 보는 동안엔
      // 아직 무료 회원이라 오답노트가 잠긴 채로 보인다.
      //
      // 이미 켠 계정은 안에서 0행 갱신으로 끝나므로 로그인할 때마다 기간이 늘어나지
      // 않는다. 실패해도 로그인을 막지 않는다(다음 조회 때 getMembership 이 켠다).
      if (data.user) {
        try {
          await startTrialIfEligible(data.user.id);
        } catch {
          // 무시 — 로그인이 우선이다.
        }
      }

      // 소셜 로그인은 닉네임을 받는 폼이 없어서, 아직 한 번도 설정한 적 없는 계정이면
      // (최초 가입이든, 온보딩 전 이탈이든) 원래 가려던 곳으로 보내기 전에 먼저 받는다.
      if (!data.user?.user_metadata?.nickname) {
        return NextResponse.redirect(
          new URL(
            `/onboarding/nickname?next=${encodeURIComponent(next)}`,
            url.origin,
          ),
        );
      }
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent("로그인에 실패했어요")}`, url.origin),
  );
}
