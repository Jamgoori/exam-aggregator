import Link from "next/link";
import { GraduationCap, Star } from "lucide-react";
import { signOutUser } from "@/app/actions";
import { SignOutButton } from "@/components/sign-out-button";
import { LoginLink } from "@/components/login-link";

export function SiteHeader({
  user,
}: {
  user: { nickname: string } | null;
}) {
  return (
    <header className="border-b border-zinc-200">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
            <GraduationCap size={22} />
          </span>
          <span className="text-2xl font-bold">공모아</span>
        </Link>

        <div className="flex items-center gap-3">
          {/* 로그인 여부와 무관하게 항상 노출해 기능 발견성을 높인다.
              비로그인 상태로 눌러도 /bookmarks가 자체적으로 로그인 유도 화면을 보여준다. */}
          <Link
            href="/bookmarks"
            className="flex items-center gap-1 text-sm text-zinc-600 hover:text-blue-600 hover:underline"
          >
            <Star size={16} />
            즐겨찾기
          </Link>

          {user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/mypage"
                className="text-sm text-zinc-600 hover:text-blue-600 hover:underline"
              >
                {user.nickname}님
              </Link>
              <form action={signOutUser}>
                <SignOutButton />
              </form>
            </div>
          ) : (
            <LoginLink className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700" />
          )}
        </div>
      </div>
    </header>
  );
}
