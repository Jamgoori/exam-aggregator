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
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "공모아 - 공무원 기출문제 자료실",
    template: "%s | 공모아",
  },
  description: "공무원 시험 기출문제 아그리게이터",
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

  const headerUser = claims
    ? {
        nickname:
          (claims.user_metadata?.nickname as string | undefined) ??
          claims.email?.split("@")[0] ??
          "회원",
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
