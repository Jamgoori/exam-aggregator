"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookMarked, Bell, Search } from "lucide-react";
import { signOutUser } from "@/app/actions";

const NAV_LINKS = [
  { href: "/", label: "자료실" },
  { href: "/?sort=year", label: "연도별" },
  { href: "/subjects", label: "과목별" },
];

export function SiteHeader({
  user,
}: {
  user: { nickname: string } | null;
}) {
  const pathname = usePathname();

  return (
    <header className="border-b border-zinc-200">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
              <BookMarked size={18} />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-semibold">기출모아</span>
              <span className="text-xs text-zinc-500">
                공무원 기출문제 자료실
              </span>
            </span>
          </Link>

          <nav className="hidden items-center gap-5 text-sm sm:flex">
            {NAV_LINKS.map((link) => {
              const isActive =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href.split("?")[0]) &&
                    link.href !== "/";
              return (
                <Link
                  key={link.label}
                  href={link.href}
                  className={
                    isActive
                      ? "font-semibold text-zinc-900"
                      : "text-zinc-500 hover:text-zinc-900"
                  }
                >
                  {link.label}
                </Link>
              );
            })}
            <span className="cursor-default text-zinc-300" title="준비 중">
              커뮤니티
            </span>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="검색"
            className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100"
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            aria-label="알림"
            className="rounded-full p-2 text-zinc-500 hover:bg-zinc-100"
          >
            <Bell size={18} />
          </button>
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-600">{user.nickname}님</span>
              <form action={signOutUser}>
                <button
                  type="submit"
                  className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-600 hover:border-zinc-400"
                >
                  로그아웃
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-zinc-700"
            >
              로그인
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
