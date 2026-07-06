import type { Metadata } from "next";
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
