import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SiteHeaderGate } from "@/components/site-header-gate";
import { createClient } from "@/lib/supabase/server";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const headerUser = user
    ? {
        nickname:
          (user.user_metadata?.nickname as string | undefined) ??
          user.email?.split("@")[0] ??
          "회원",
      }
    : null;

  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <SiteHeaderGate user={headerUser} />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
