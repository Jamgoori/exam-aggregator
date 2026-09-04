"use client";

import Link from "next/link";
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

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/85 backdrop-blur-md print:hidden dark:border-zinc-700 dark:bg-zinc-950/85">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-1 px-4">
        <Link
          href="/"
          aria-label="공모아 홈"
          // 로고는 언제나 홈(랜딩)으로 간다. 검색 목록이 홈에 살던 시절에는 여기서
          // 목록을 1페이지로 되돌리는 이벤트를 쏘았는데, 목록이 /papers 로 옮겨간
          // 뒤로 그 일은 메뉴의 "기출문제" 항목(mobile-nav.tsx)이 맡는다.
          // usePathname()은 안 쓴다 — pending(인증 확정 전) 상태의 이 헤더는
          // layout의 Suspense 폴백으로 정적 셸에 그대로 구워지는데, 그 경로에서
          // 라우터 훅을 호출하면(값을 안 써도) 정적 셸 자체가 사라진다(위 pending
          // 관련 주석 참고).
          className="mr-1 flex shrink-0 items-center gap-2 rounded-lg focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:outline-none"
        >
          {/* 로고 색은 홈(랜딩)의 팔레트(초록 accent)를 따른다 — 사이트 안 도구 화면의
              파랑과 달리, 로고는 어느 화면에서나 "공모아"라는 브랜드 하나만 가리킨다. */}
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#12b382] text-white shadow-sm shadow-[#12b382]/30">
            <GraduationCap size={22} />
          </span>
          <span className="text-2xl font-bold text-[#12b382]">공모아</span>
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
