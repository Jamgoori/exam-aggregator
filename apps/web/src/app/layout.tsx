import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { GoogleAnalytics } from "@next/third-parties/google";
import { SiteHeaderGate } from "@/components/site-header-gate";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ReviewFab } from "@/components/review-fab";
import { MicrosoftClarity } from "@/components/microsoft-clarity";
import { createClient } from "@/lib/supabase/server";
import { getMembership } from "@/lib/membership";
import { isPremiumMembership } from "@gongmoa/core";
import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site-url";
import { JsonLd } from "@/components/json-ld";
import "./globals.css";

// 네이버 서치어드바이저(searchadvisor.naver.com)가 발급한 사이트 소유확인 값.
const NAVER_SITE_VERIFICATION = "0c7170c9fa14f6a8d7dd7523de328de8e3e37062";

// canonical(alternates)과 openGraph.url은 여기 두면 안 된다 — Next의 메타데이터는
// 하위 라우트가 덮어쓰지 않는 필드를 그대로 물려받아서, 루트에 canonical을 박으면
// 모든 문제지 상세페이지가 홈을 정본으로 가리키며 색인에서 통째로 사라진다.
// 페이지마다 자기 canonical을 선언한다(홈은 app/page.tsx).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "공모아 - 공무원 기출문제 자료실",
    template: "%s | 공모아",
  },
  // 네이버는 검색 결과에 설명문을 그대로 싣고 80자를 넘기면 잘라내므로(서치어드바이저
  // "사이트 간단 체크"가 경고한다) 80자 안에 핵심 키워드가 다 들어가게 줄여 쓴다.
  description:
    "국가직·지방직 등 공무원 기출문제를 연도별·과목별로 모아 정답·해설과 함께 무료로 제공합니다. 온라인 CBT 풀이도 가능합니다.",
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "ko_KR",
  },
  // opengraph-image.tsx 가 만들어주는 1200×630 카드를 잘리지 않게 크게 보여준다.
  twitter: { card: "summary_large_image" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      // 검색 결과에 본문 발췌와 미리보기 이미지가 잘리지 않고 나오도록 상한을 푼다.
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
  // 검색엔진 소유권 확인용 메타 태그 (구글 Search Console / 네이버 서치어드바이저 /
  // 빙 웹마스터). 네이버는 Next 메타데이터에 전용 필드가 없어서 other 로 이름을 준다.
  //
  // 확인이 끝난 뒤에도 태그가 사라지면 소유권이 해제되므로, 값을 env 에만 두지
  // 않는다 — 환경변수 하나가 빠지면 조용히 등록이 풀린다. 어차피 HTML 에 그대로
  // 드러나는 공개 문자열이라 숨길 이유도 없어서 아래 상수를 기본값으로 쓰고,
  // env 가 있으면(도메인 이전 등) 그쪽을 우선한다.
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
    other: {
      "naver-site-verification":
        process.env.NAVER_SITE_VERIFICATION ?? NAVER_SITE_VERIFICATION,
      ...(process.env.BING_SITE_VERIFICATION && {
        "msvalidate.01": process.env.BING_SITE_VERIFICATION,
      }),
    },
  },
};

// 기본값(resizes-content)은 모바일 키보드가 열고 닫힐 때 레이아웃 뷰포트 자체의
// 높이를 바꿔 페이지가 다시 리플로우/스크롤된다 — 검색창에 포커스가 남은 채로
// 카드를 탭하면, 탭 도중 키보드가 닫히며 화면이 밀려 올라가 손가락 아래
// 엉뚱한 카드가 눌리는 사고가 난다. resizes-visual로 바꾸면 키보드는 시각
// 뷰포트만 가리고 레이아웃은 그대로 유지되어 이 리플로우 자체가 없어진다.
export const viewport: Viewport = {
  interactiveWidget: "resizes-visual",
};

// 헤더에 닉네임을 보여주기 위한 용도라 인증 서버까지 왕복하는 getUser() 대신
// JWT를 로컬에서 검증하는 getClaims()를 쓴다 (모든 페이지가 이 레이아웃을 거치므로
// 페이지마다 인증 서버 왕복이 하나씩 붙는 것을 없애준다). 세션 갱신은 프록시
// 미들웨어가 담당하고, 실제 데이터 접근 권한은 각 쿼리의 RLS가 검증한다.
//
// cookies() 접근은 런타임 데이터라 Cache Components에서는 Suspense 경계 뒤에
// 있어야 한다 — 레이아웃 본문에서 바로 읽으면 정적 셸이 아예 안 만들어지므로,
// 헤더만 비동기 컴포넌트로 분리해 스트리밍한다.
async function StreamedSiteHeader() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  // is_admin()은 DB 왕복이 있는 쿼리라 비로그인 방문자(=대부분의 트래픽)에게는
  // 아예 부르지 않는다 — 로그인 사용자에 한해서만, 그것도 admins 테이블 이메일
  // 인덱스 조회 한 번이라 비용이 작다. 위 getClaims()는 로컬 JWT 검증이라 이
  // 조회와 무관하게 계속 DB를 안 탄다.
  const isAdmin = claims ? (await supabase.rpc("is_admin")).data === true : false;
  // 관리자는 멤버십 레코드와 무관하게 유료 기능을 다 쓰므로, 배지도 멤버십 페이지의
  // "관리자 계정" 취급과 맞춰 멤버십으로 본다.
  const isPremium = claims
    ? isAdmin || isPremiumMembership(await getMembership(supabase, claims.sub))
    : false;

  const headerUser = claims
    ? {
        nickname:
          (claims.user_metadata?.nickname as string | undefined) ??
          claims.email?.split("@")[0] ??
          "회원",
        isAdmin,
        isPremium,
      }
    : null;

  return (
    <>
      <SiteHeaderGate user={headerUser} />
      {/* 스크롤을 내리면 따라오는 "복습 N" 버튼. 로그인한 사람에게만 붙인다 —
          비로그인 방문자에게는 셀 것도 없는데 조회만 한 번 더 도는 셈이다. */}
      {headerUser && <ReviewFab />}
    </>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* data-theme를 첫 페인트 전에 동기적으로 세팅해서 라이트→다크 깜빡임을 없앤다.
            저장된 값이 없으면 시스템 설정을 기본값으로 쓴다. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full">
        {/* 사이트 전역 구조화 데이터. WebSite+SearchAction은 검색 결과에 사이트
            내부 검색창(sitelinks searchbox)이 붙을 수 있게 하고, 두 엔티티에 @id를
            달아 페이지별 JSON-LD(문제지 상세의 BreadcrumbList 등)가 같은 사이트를
            가리키도록 묶어준다. */}
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebSite",
                "@id": `${SITE_URL}/#website`,
                url: SITE_URL,
                name: SITE_NAME,
                inLanguage: "ko-KR",
                publisher: { "@id": `${SITE_URL}/#organization` },
                potentialAction: {
                  "@type": "SearchAction",
                  target: {
                    "@type": "EntryPoint",
                    urlTemplate: absoluteUrl("/?q={search_term_string}"),
                  },
                  "query-input": "required name=search_term_string",
                },
              },
              {
                "@type": "Organization",
                "@id": `${SITE_URL}/#organization`,
                name: SITE_NAME,
                url: SITE_URL,
              },
            ],
          }}
        />
        {/* 폴백은 정적 셸에 들어가므로 usePathname(런타임 데이터)을 쓰는
            SiteHeaderGate 대신 순수한 SiteHeader를 깔아둔다. 몰입형(CBT) 화면
            여부에 따른 숨김은 실제 헤더가 스트리밍되면서 적용된다. */}
        <Suspense fallback={<SiteHeader user="pending" />}>
          <StreamedSiteHeader />
        </Suspense>
        {children}
        {/* 푸터도 usePathname으로 몰입형 화면을 판별하므로 Suspense 뒤에 둔다 —
            페이지 맨 아래라 잠깐 비어 있어도 눈에 띄지 않는다. */}
        <Suspense fallback={null}>
          <SiteFooter />
        </Suspense>
        <Analytics />
        {process.env.NEXT_PUBLIC_GA_ID && (
          <GoogleAnalytics gaId={process.env.NEXT_PUBLIC_GA_ID} />
        )}
        {process.env.NEXT_PUBLIC_CLARITY_ID && (
          <MicrosoftClarity projectId={process.env.NEXT_PUBLIC_CLARITY_ID} />
        )}
      </body>
    </html>
  );
}
