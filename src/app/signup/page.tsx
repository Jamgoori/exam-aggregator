import Link from "next/link";
import { signUpUser } from "@/app/actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-2xl font-semibold">회원가입</h1>
      <form action={signUpUser} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="nickname" className="text-sm text-zinc-600">
            닉네임
          </label>
          <input
            id="nickname"
            name="nickname"
            required
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm text-zinc-600">
            이메일
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm text-zinc-600">
            비밀번호 (6자 이상)
          </label>
          <input
            id="password"
            name="password"
            type="password"
            minLength={6}
            required
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          가입하기
        </button>
      </form>
      <p className="text-sm text-zinc-500">
        이미 계정이 있나요?{" "}
        <Link href="/login" className="text-blue-600 underline-offset-2 hover:underline">
          로그인
        </Link>
      </p>
    </div>
  );
}
