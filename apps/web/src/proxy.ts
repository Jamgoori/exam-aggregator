import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPaperSlug } from "@gongmoa/core";

// 옛 주소 /papers/<UUID>[/cbt|/explanations] 를 알아보는 패턴. 새 주소(slug)는 항상
// 연도 네 자리로 시작하므로 여기 걸리지 않는다.
const LEGACY_PAPER_PATH =
  /^\/papers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/.*)?$/i;

/**
 * 문제지 주소가 UUID 에서 제목 기반 slug 로 바뀌었다. 옛 주소는 검색엔진 색인·
 * 북마크·외부 링크에 3,800개가 남아 있으므로 새 주소로 301 을 보내야 한다.
 *
 * **왜 페이지가 아니라 여기서 하나:** 이 앱은 정적 셸을 먼저 흘려보내는(PPR) 구조라,
 * 페이지 컴포넌트 안에서 redirect() 를 불러도 응답이 이미 시작된 뒤라 상태 코드가
 * 200 으로 나간다(같은 이유로 notFound() 도 200 이 된다 — 실측). 검색엔진에게
 * "주소가 영구히 옮겨갔다"고 말하려면 렌더링이 시작되기 전인 여기서 보내야 한다.
 *
 * 조회 비용은 옛 주소로 들어온 요청에만 붙는다. 정상 주소는 위 정규식에서 바로
 * 빠지므로 평소 경로에는 아무것도 더해지지 않는다.
 */
async function redirectLegacyPaperUrl(
  request: NextRequest,
  supabase: ReturnType<typeof createServerClient>,
): Promise<NextResponse | null> {
  const match = LEGACY_PAPER_PATH.exec(request.nextUrl.pathname);
  if (!match) return null;

  const [, id, suffix] = match;
  const { data } = await supabase
    .from("exam_papers")
    .select("title, round, track")
    .eq("id", id)
    .single();
  // 없는 문제지면 그냥 통과시킨다 — 페이지가 404 를 그리게 두는 편이,
  // 아무 데로나 돌려보내는 것보다 정직하다.
  if (!data) return null;

  const url = request.nextUrl.clone();
  url.pathname = `/papers/${getPaperSlug(data.title as string, data.round as number, data.track as string | null)}${suffix ?? ""}`;
  return NextResponse.redirect(url, 301);
}

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

  const legacyRedirect = await redirectLegacyPaperUrl(request, supabase);
  if (legacyRedirect) return legacyRedirect;

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
