import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the auth session cookie if needed; required for Supabase
  // auth to work correctly in Server Components. getClaims()는 프로젝트가
  // 비대칭(ECC/RSA) JWT 서명 키를 쓰면 인증 서버 왕복 없이 로컬에서 검증하므로
  // getUser()보다 훨씬 빠르다 (대칭 키면 getUser()와 동일하게 동작).
  await supabase.auth.getClaims();

  return response;
}

export const config = {
  // 정적 자산에는 세션 갱신이 전혀 필요 없는데도 프록시를 태우면 요청마다 Supabase
  // 쿠키 파싱/검증 비용이 붙는다. 특히 /pdf.worker.min.mjs(1MB+, CBT 진입마다 로드)가
  // 기존 패턴(svg|png|jpg|jpeg|webp)에 안 걸려서 매번 프록시를 통과하고 있었다.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|pdf|woff2?|ttf|otf|map|txt|xml|webmanifest)$).*)",
  ],
};
