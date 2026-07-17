import Link from "next/link";
import Script from "next/script";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-2xl font-semibold">비밀번호 찾기</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        가입한 이메일로 비밀번호 재설정 링크를 보내드려요.
      </p>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <ForgotPasswordForm turnstileSiteKey={turnstileSiteKey} />

      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        <Link
          href="/login"
          className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          로그인으로 돌아가기
        </Link>
      </p>

      {turnstileSiteKey && (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
      )}
    </div>
  );
}
