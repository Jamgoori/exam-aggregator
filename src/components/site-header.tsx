import Link from "next/link";
import { BookMarked, Bell, Search } from "lucide-react";
import { signOutUser } from "@/app/actions";

export function SiteHeader({
  user,
}: {
  user: { nickname: string } | null;
}) {
  return (
    <header className="border-b border-zinc-200">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
            <BookMarked size={18} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-semibold">공기모아</span>
            <span className="text-xs text-zinc-500">
              공무원 기출문제 자료실
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="검색"
            className="rounded-full p-2 text-zinc-500 hover:bg-blue-50 hover:text-blue-600"
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            aria-label="알림"
            className="rounded-full p-2 text-zinc-500 hover:bg-blue-50 hover:text-blue-600"
          >
            <Bell size={18} />
          </button>
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-zinc-600">{user.nickname}님</span>
              <form action={signOutUser}>
                <button
                  type="submit"
                  className="rounded-full border border-zinc-200 px-4 py-1.5 text-sm font-medium text-zinc-600 hover:border-blue-300 hover:text-blue-600"
                >
                  로그아웃
                </button>
              </form>
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              로그인
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
