"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { MobileNav } from "@/components/mobile-nav";

// 사이트 공통 헤더 = 메뉴바.
//
// 높이는 65px(h-16 + 아래 테두리 1px)로 고정한다. cbt-solver.tsx / review-solver.tsx가
// 데스크톱 풀이 화면 높이를 calc(100dvh-65px)로 잡고 있어서, 여기 높이를 바꾸면 풀이
// 화면 아래가 잘리거나 남는다. 높이를 바꿔야 한다면 그 두 파일도 같이 고칠 것.
//
// PC에서도 상단에 탭을 가로로 늘어놓지 않고, 모바일과 똑같이 햄버거 → 서랍
// 메뉴 하나로 통일한다(모바일 앱의 하단 탭바처럼 "메뉴는 한 곳" 원칙). 그래서
// 화면 폭과 상관없이 로고 + 테마 토글 + 햄버거만 보인다. 실제 메뉴 항목·계정
// 정보·로그인 버튼은 전부 MobileNav의 서랍 쪽에서만 렌더된다.
//
// user가 "pending"이면 아직 인증 확인(getClaims)이 스트리밍 중이라는 뜻이다. 이 상태의
// 헤더는 레이아웃의 Suspense 폴백 — 즉 정적 셸에 그대로 구워지므로, 그 경로에서는
// usePathname 같은 런타임 값을 절대 읽으면 안 된다(읽는 순간 모든 페이지의 정적 셸이
// 사라진다). 그래서 서랍은 인증이 확정된 뒤 렌더되는 MobileNav 쪽에만 두고, pending
// 동안에는 햄버거 자리에 스켈레톤만 깐다.
export function SiteHeader({
  user,
}: {
  user: { nickname: string; isAdmin: boolean; isPremium: boolean } | null | "pending";
}) {
  const pending = user === "pending";
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur-md print:hidden dark:border-zinc-700 dark:bg-zinc-950/85">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-1 px-4">
        <Link
          href="/"
          aria-label="공모아 홈"
          // 홈에서 페이지네이션으로 여러 페이지째 보고 있을 때 이 로고를 눌러도,
          // HomeExamBrowser의 페이지 상태는 history.replaceState로만 URL과
          // 동기화될 뿐 Next 라우터가 모르는 값이라 같은 "/"로의 Link는 아무
          // 리렌더도 트리거하지 않아 이전 페이지에 그대로 머물렀다. 이미 홈에
          // 있을 때는 라우팅 대신 커스텀 이벤트로 그 상태를 직접 1페이지로
          // 되돌린다.
          onClick={(e) => {
            if (pathname === "/") {
              e.preventDefault();
              window.history.replaceState(null, "", "/");
              window.dispatchEvent(new Event("gongmoa:home-reset"));
            }
          }}
          className="mr-1 flex shrink-0 items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-600/25">
            <GraduationCap size={22} />
          </span>
          <span className="text-2xl font-bold dark:text-zinc-100">공모아</span>
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ThemeToggle />
          {pending ? (
            // 인증 확정 전. 실제로 들어올 햄버거 버튼과 같은 크기라 값이 도착해도
            // 헤더가 출렁이지 않는다.
            <div className="skeleton h-9 w-9 rounded-full" />
          ) : (
            <MobileNav user={user} />
          )}
        </div>
      </div>
    </header>
  );
}
