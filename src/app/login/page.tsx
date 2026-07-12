import Link from "next/link";
import { signInUser, signInWithGoogle } from "@/app/actions";
import { GoogleIcon } from "@/components/google-icon";
import { sanitizeNextPath } from "@/lib/safe-redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  const { error, message, next: rawNext } = await searchParams;
  const next = sanitizeNextPath(rawNext);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-2xl font-semibold">로그인</h1>

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-2 rounded border border-zinc-300 px-4 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
        >
          <GoogleIcon />
          Google로 계속하기
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        또는
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <form action={signInUser} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-1">
          <label htmlFor="username" className="text-sm text-zinc-600 dark:text-zinc-400">
            아이디
          </label>
          <input
            id="username"
            name="username"
            required
            autoComplete="username"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm text-zinc-600 dark:text-zinc-400">
            비밀번호
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {message && <p className="text-sm text-green-600 dark:text-green-400">{message}</p>}
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          로그인
        </button>
      </form>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        계정이 없나요?{" "}
        <Link
          href={`/signup?next=${encodeURIComponent(next)}`}
          className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          회원가입
        </Link>
      </p>
    </div>
  );
}
