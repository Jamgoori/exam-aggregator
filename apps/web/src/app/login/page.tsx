import Link from "next/link";
import { signInWithGoogle, signInWithKakao } from "@/app/actions";
import { GoogleIcon } from "@/components/google-icon";
import { KakaoIcon } from "@/components/kakao-icon";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { BookOpenCheck, BrainCircuit, Monitor } from "lucide-react";
import { DIAGNOSIS_MIN_ATTEMPTS } from "@/lib/ai-diagnosis-thresholds";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  const { error, message, next: rawNext } = await searchParams;
  const next = sanitizeNextPath(rawNext);
  // CBT 를 누르다 여기로 튕겨 온 사람에게는 "이 문제지 바로 시작"이 로그인의 이유다.
  // 그 외에는 일반 안내.
  const fromCbt = /^\/papers\/[^/]+\/cbt(\/|$)/.test(next);

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-16 sm:py-24">
      <div>
        <h1 className="text-2xl font-semibold">
          {fromCbt ? "로그인하고 바로 시작하기" : "로그인"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          {fromCbt
            ? "로그인이 끝나면 고른 문제지의 응시 화면으로 바로 이어져요. 처음이라면 로그인과 동시에 가입돼요."
            : "처음이라면 로그인과 동시에 가입돼요."}
        </p>
      </div>

      {/* 이 화면이 최대 이탈 지점이다 — CBT 를 누르자마자 만나는 문이라, 왜 열어야
          하는지를 문 앞에서 말한다. */}
      <ul className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3.5 text-[13px] text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-100">
        <li className="flex items-center gap-2">
          <Monitor size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          온라인 CBT 응시 기록과 회독이 계정에 남아요
        </li>
        <li className="flex items-center gap-2">
          <BookOpenCheck size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          틀린 문제는 오답노트에 자동으로 쌓여요
        </li>
        <li className="flex items-center gap-2">
          <BrainCircuit size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          {DIAGNOSIS_MIN_ATTEMPTS}회만 풀면 AI가 약점을 개념 단위로 짚어줘요
        </li>
      </ul>

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
        로그인하면{" "}
        <Link
          href="/terms"
          className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          이용약관
        </Link>
        과{" "}
        <Link
          href="/privacy"
          className="underline underline-offset-2 hover:text-zinc-600 dark:hover:text-zinc-300"
        >
          개인정보처리방침
        </Link>
        에 동의한 것으로 간주돼요. 계정 관리(비밀번호·복구)는 구글/카카오 계정 설정을 따라요.
      </p>
    </div>
  );
}
