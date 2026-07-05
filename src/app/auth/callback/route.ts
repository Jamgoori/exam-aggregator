import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeNextPath } from "@/lib/safe-redirect";

// Supabase OAuth(구글 등) 로그인이 끝나면 provider가 이 경로로 ?code=...를 붙여서 돌려보낸다.
// 여기서 code를 세션으로 교환해 쿠키에 심어야 로그인 상태가 된다.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = sanitizeNextPath(url.searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // 구글 로그인은 닉네임을 받는 폼이 없어서, 아직 한 번도 설정한 적 없는 계정이면
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
    new URL(`/login?error=${encodeURIComponent("구글 로그인에 실패했어요")}`, url.origin),
  );
}
