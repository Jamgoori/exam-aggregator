"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteFooter() {
  const pathname = usePathname();
  // CBT/복습 풀이 화면은 몰입형 레이아웃이라(site-header-gate와 동일 기준) 푸터도 숨긴다 —
  // 풀이 중 스크롤 끝에 푸터가 걸리면 OMR 조작을 방해한다.
  const isImmersiveSolvePage =
    /^\/papers\/[^/]+\/cbt(\/|$)/.test(pathname ?? "") ||
    /^\/mypage\/wrong-notes\/[^/]+\/review\/[^/]+/.test(pathname ?? "");
  if (isImmersiveSolvePage) return null;

  return (
    <footer className="mt-6 border-t border-zinc-100 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 text-xs text-zinc-400 dark:text-zinc-500">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/terms" className="hover:text-zinc-600 dark:hover:text-zinc-300">
            이용약관
          </Link>
          <Link
            href="/privacy"
            className="font-medium hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            개인정보처리방침
          </Link>
          <a
            href="mailto:lks2354@gmail.com"
            className="hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            문의
          </a>
        </div>
        <p>© 2026 공모아 — 공무원 기출문제 자료실</p>
      </div>
    </footer>
  );
}
