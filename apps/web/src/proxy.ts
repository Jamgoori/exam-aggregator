import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getPaperSlug } from "@gongmoa/core";
import {
  BYPASS_COOKIE,
  BYPASS_HEADER,
  BYPASS_QUERY,
  COUNTRY_HEADERS,
  decideGeoBlock,
  geoBlockHtml,
  readGeoBlockConfig,
} from "@/lib/geo-block";

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

// 해외 접속 차단 설정. 모듈 최상단에서 한 번만 읽는다 — Edge 런타임은
// process.env 를 빌드 시점에 인라인하므로 요청마다 다시 읽어봐야 값이 바뀌지 않는다
// (값을 바꾸려면 Vercel 에서 환경변수를 고치고 재배포한다).
const GEO = readGeoBlockConfig({
  GEO_BLOCK: process.env.GEO_BLOCK,
  GEO_BLOCK_COUNTRIES: process.env.GEO_BLOCK_COUNTRIES,
  GEO_BLOCK_BYPASS_TOKEN: process.env.GEO_BLOCK_BYPASS_TOKEN,
});

/**
 * 해외(한국·일본 외) 접속 차단. 판정 규칙과 근거는 lib/geo-block.ts 에 있다.
 *
 * 세션 갱신보다 **먼저** 부른다. 어차피 돌려보낼 요청에 Supabase 쿠키 검증까지 붙일
 * 이유가 없고, 차단 응답에 로그인 쿠키가 섞여 나가지도 않는다.
 *
 * 프리뷰 배포에서는 켜지 않는다. 프리뷰는 사람과 도구가 밖에서 열어 확인하는
 * 자리라(코드 리뷰·에이전트·모바일 확인), 여기까지 막으면 확인할 방법이 없어진다.
 */
function geoBlock(request: NextRequest): NextResponse | null {
  if (!GEO.enabled) return null;
  if (process.env.VERCEL_ENV === "preview") return null;

  const country =
    COUNTRY_HEADERS.map((h) => request.headers.get(h)).find((v) => v) ?? null;

  const decision = decideGeoBlock(GEO, {
    pathname: request.nextUrl.pathname,
    country,
    userAgent: request.headers.get("user-agent"),
    bypassHeader: request.headers.get(BYPASS_HEADER),
    bypassQuery: request.nextUrl.searchParams.get(BYPASS_QUERY),
    bypassCookie: request.cookies.get(BYPASS_COOKIE)?.value ?? null,
  });

  if (decision.action === "allow") {
    if (!decision.setBypassCookie) return null;
    // 링크를 한 번 연 뒤에는 주소에 토큰을 달고 다니지 않아도 되게 쿠키로 옮긴다.
    // 토큰이 Referer 로 새는 것도 이쪽이 낫다.
    const url = request.nextUrl.clone();
    url.searchParams.delete(BYPASS_QUERY);
    const redirect = NextResponse.redirect(url);
    redirect.cookies.set(BYPASS_COOKIE, GEO.bypassToken!, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return redirect;
  }

  return new NextResponse(geoBlockHtml(decision.country), {
    status: 403,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // 차단 화면이 색인되면 검색 결과에 이 문구가 뜬다.
      "x-robots-tag": "noindex, nofollow",
      // 국가별로 다른 응답이라 어디에도 캐시되면 안 된다 — 한 번 캐시되면 국내
      // 사용자에게도 차단 화면이 나간다.
      "cache-control": "no-store, must-revalidate",
    },
  });
}

/**
 * 로그인 세션 쿠키(@supabase/ssr 이 심는 `sb-<ref>-auth-token`)가 하나라도 있는지.
 *
 * 없으면 갱신할 세션 자체가 없으므로 아래에서 Supabase 클라이언트를 만들지도, 토큰을
 * 검증하지도 않는다. 이 사이트 트래픽의 대부분은 로그인하지 않은 검색·수집 봇인데,
 * 그 요청 하나하나에 쿠키 파싱 + 토큰 검증을 붙이면 실제로 하는 일이 없는 CPU 시간이
 * 요청 수만큼 쌓인다 (Vercel 실측: 사용자 없는 6일 동안 함수 호출 103만 건).
 */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.startsWith("sb-"));
}

export async function proxy(request: NextRequest) {
  const blocked = geoBlock(request);
  if (blocked) return blocked;

  const isLegacyPaperUrl = LEGACY_PAPER_PATH.test(request.nextUrl.pathname);

  // 익명 요청이고 옛 주소도 아니면 여기서 할 일이 없다. 아무것도 만들지 않고 통과.
  if (!hasSessionCookie(request) && !isLegacyPaperUrl) {
    return NextResponse.next({ request });
  }

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
  //
  // 세션 쿠키가 있을 때만 부른다 — 없으면 갱신할 것이 없어 왕복이 통째로 낭비다.
  if (hasSessionCookie(request)) {
    await supabase.auth.getClaims();
  }

  if (isLegacyPaperUrl) {
    const legacyRedirect = await redirectLegacyPaperUrl(request, supabase);
    if (legacyRedirect) return legacyRedirect;
  }

  return response;
}

export const config = {
  // 정적 자산에는 세션 갱신이 전혀 필요 없는데도 프록시를 태우면 요청마다 Supabase
  // 쿠키 파싱/검증 비용이 붙는다. 특히 /pdf.worker.min.mjs(1MB+, CBT 진입마다 로드)가
  // 기존 패턴(svg|png|jpg|jpeg|webp)에 안 걸려서 매번 프록시를 통과하고 있었다.
  //
  // opengraph-image 도 같은 이유로 뺀다. 로그인과 무관한 이미지인데(지오블록 판정에서도
  // 설비 경로로 통과시킨다) 문제지마다 하나씩 있어서, 크롤러가 사이트를 훑을 때마다
  // 카드 렌더링과 별개로 프록시 호출이 그 수만큼 따라붙는다.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*opengraph-image[^/]*$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|pdf|woff2?|ttf|otf|map|txt|xml|webmanifest)$).*)",
  ],
};
