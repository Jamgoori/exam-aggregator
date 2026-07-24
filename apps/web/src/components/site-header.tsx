import Link from "next/link";
import { GraduationCap } from "lucide-react";
import { signOutUser } from "@/app/actions";
import { SignOutButton } from "@/components/sign-out-button";
import { LoginLink } from "@/components/login-link";
import { ThemeToggle } from "@/components/theme-toggle";

// user가 "pending"이면 아직 인증 확인(getClaims)이 스트리밍 중이라는 뜻 —
// 로그인 버튼을 잘못 깜빡이지 않도록 그 자리에 스켈레톤 알약을 깔아둔다.
export function SiteHeader({
  user,
}: {
  user: { nickname: string } | null | "pending";
}) {
  return (
    <header className="border-b border-zinc-200 print:hidden dark:border-zinc-700">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
            <GraduationCap size={22} />
          </span>
          <span className="text-2xl font-bold dark:text-zinc-100">공모아</span>
        </Link>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user === "pending" ? (
            <div className="skeleton h-8 w-24 rounded-full" />
          ) : user ? (
            <div className="flex items-center gap-2">
              <Link
                href="/mypage"
                className="text-sm text-zinc-600 hover:text-blue-600 hover:underline dark:text-zinc-400 dark:hover:text-blue-400"
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
