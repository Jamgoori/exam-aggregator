"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GraduationCap } from "lucide-react";
import { LoginLink } from "@/components/login-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { MobileNav } from "@/components/mobile-nav";
import { PRIMARY_NAV } from "@/components/site-nav-items";

// 사이트 공통 헤더 = 메뉴바.
//
// 높이는 65px(h-16 + 아래 테두리 1px)로 고정한다. cbt-solver.tsx / review-solver.tsx가
// 데스크톱 풀이 화면 높이를 calc(100dvh-65px)로 잡고 있어서, 여기 높이를 바꾸면 풀이
// 화면 아래가 잘리거나 남는다. 높이를 바꿔야 한다면 그 두 파일도 같이 고칠 것.
//
// user가 "pending"이면 아직 인증 확인(getClaims)이 스트리밍 중이라는 뜻이다. 이 상태의
// 헤더는 레이아웃의 Suspense 폴백 — 즉 정적 셸에 그대로 구워지므로, 그 경로에서는
// usePathname 같은 런타임 값을 절대 읽으면 안 된다(읽는 순간 모든 페이지의 정적 셸이
// 사라진다). 그래서 메뉴바 활성 표시·계정 메뉴·모바일 서랍은 전부 인증이 확정된 뒤
// 렌더되는 하위 컴포넌트 쪽에만 두고, pending 동안에는 링크만 있는 같은 모양을 깐다.
export function SiteHeader({
  user,
}: {
  user: { nickname: string } | null | "pending";
}) {
  const pending = user === "pending";

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur-md print:hidden dark:border-zinc-700 dark:bg-zinc-950/85">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-1 px-4">
        <Link
          href="/"
          aria-label="공모아 홈"
          className="mr-1 flex shrink-0 items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm shadow-blue-600/25">
            <GraduationCap size={22} />
          </span>
          <span className="text-2xl font-bold dark:text-zinc-100">공모아</span>
        </Link>

        {/* 메뉴바 본줄. 좁은 화면에서는 이 자리가 오른쪽 햄버거(모바일 서랍)로 바뀐다. */}
        {pending ? <NavBar pathname={null} /> : <ActiveNavBar />}

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ThemeToggle />
          {pending ? (
            // 인증 확정 전. 실제로 들어올 알약(계정 버튼/로그인 버튼)과 같은 크기라
            // 값이 도착해도 헤더가 출렁이지 않는다.
            <>
              <div className="skeleton hidden h-9 w-28 rounded-full md:block" />
              <div className="skeleton h-9 w-9 rounded-full md:hidden" />
            </>
          ) : (
            <>
              {user ? (
                <div className="hidden md:block">
                  <UserMenu nickname={user.nickname} />
                </div>
              ) : (
                <LoginLink className="hidden rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 md:block" />
              )}
              <MobileNav user={user} />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

// 현재 경로를 아는 메뉴바. usePathname을 쓰므로 인증이 확정된(=Suspense 안쪽)
// 경로에서만 렌더된다 — 위 컴포넌트 주석 참고.
function ActiveNavBar() {
  const pathname = usePathname();
  return <NavBar pathname={pathname} />;
}

function NavBar({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="주요 메뉴" className="hidden h-16 items-center md:ml-2 md:flex lg:ml-4">
      {PRIMARY_NAV.map((item) => {
        const active = pathname ? item.match(pathname) : false;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            // 밑줄은 헤더 아래 테두리 위에 딱 붙는다 — 지금 보고 있는 화면이
            // 메뉴바에서 어디에 속하는지를 글자색보다 먼저 알려주는 표시다.
            className={`relative flex h-full items-center px-3 text-[15px] font-semibold lg:px-3.5 transition-colors after:absolute after:inset-x-2.5 after:bottom-0 after:h-[3px] after:rounded-t-full after:transition-colors focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none focus-visible:ring-inset ${
              active
                ? "text-blue-600 after:bg-blue-600 dark:text-blue-400 dark:after:bg-blue-400"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
