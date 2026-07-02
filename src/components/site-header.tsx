import Link from "next/link";
import { BookMarked } from "lucide-react";
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
            <span className="font-semibold">공모아</span>
            <span className="text-xs text-zinc-500">
              공무원 기출문제 자료실
            </span>
          </span>
        </Link>

        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/mypage"
                className="text-sm text-zinc-600 hover:text-blue-600 hover:underline"
              >
                {user.nickname}님
              </Link>
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
