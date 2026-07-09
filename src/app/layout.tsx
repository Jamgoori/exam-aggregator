import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SiteHeaderGate } from "@/components/site-header-gate";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  // 헤더에 닉네임을 보여주기 위한 용도라 인증 서버까지 왕복하는 getUser() 대신
  // JWT를 로컬에서 검증하는 getClaims()를 쓴다 (모든 페이지가 이 레이아웃을 거치므로
  // 페이지마다 인증 서버 왕복이 하나씩 붙는 것을 없애준다). 세션 갱신은 프록시
  // 미들웨어가 담당하고, 실제 데이터 접근 권한은 각 쿼리의 RLS가 검증한다.
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
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full">
        <SiteHeaderGate user={headerUser} />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
