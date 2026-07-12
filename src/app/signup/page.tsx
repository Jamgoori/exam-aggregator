import Link from "next/link";
import Script from "next/script";
import { signInWithGoogle } from "@/app/actions";
import { GoogleIcon } from "@/components/google-icon";
import { SignupForm } from "@/components/signup-form";
import { sanitizeNextPath } from "@/lib/safe-redirect";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = sanitizeNextPath(rawNext);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-2xl font-semibold">회원가입</h1>

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

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        또는
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <SignupForm next={next} turnstileSiteKey={turnstileSiteKey} />

      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        이미 계정이 있나요?{" "}
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          로그인
        </Link>
      </p>

      {turnstileSiteKey && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      )}
    </div>
  );
}
