import Link from "next/link";
import Script from "next/script";
import { FindIdForm } from "@/components/find-id-form";

export default function FindIdPage() {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-2xl font-semibold">아이디 찾기</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        로그인 아이디는 가입 시 등록한 이메일이에요. 닉네임으로 조회하면 마스킹된
        이메일을 보여드려요.
      </p>

      <FindIdForm turnstileSiteKey={turnstileSiteKey} />

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
