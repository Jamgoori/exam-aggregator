import { signInWithGoogle, signInWithKakao } from "@/app/actions";
import { GoogleIcon } from "@/components/google-icon";
import { KakaoIcon } from "@/components/kakao-icon";
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
      <div>
        <h1 className="text-2xl font-semibold">로그인</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          처음이라면 로그인과 동시에 가입돼요.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded border border-zinc-300 px-4 py-2.5 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
          >
            <GoogleIcon />
            Google로 계속하기
          </button>
        </form>

        <form action={signInWithKakao}>
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded bg-[#FEE500] px-4 py-2.5 text-black/90 hover:brightness-95"
          >
            <KakaoIcon />
            카카오로 계속하기
          </button>
        </form>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p className="text-sm text-green-600 dark:text-green-400">{message}</p>}

      <p className="text-xs text-zinc-400 dark:text-zinc-500">
        로그인은 회원가입을 겸하며, 계정 관리(비밀번호·복구)는 구글/카카오 계정 설정을
        따라요.
      </p>
    </div>
  );
}
