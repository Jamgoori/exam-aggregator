import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Supabase OAuth(구글 등) 로그인이 끝나면 provider가 이 경로로 ?code=...를 붙여서 돌려보낸다.
// 여기서 code를 세션으로 교환해 쿠키에 심어야 로그인 상태가 된다.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  return NextResponse.redirect(
    new URL(`/login?error=${encodeURIComponent("구글 로그인에 실패했어요")}`, url.origin),
  );
}
