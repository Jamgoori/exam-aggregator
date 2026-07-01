import Link from "next/link";
import { signInUser } from "@/app/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-2xl font-semibold">로그인</h1>
      <form action={signInUser} className="flex flex-col gap-4">
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
            비밀번호
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="rounded border border-zinc-300 px-3 py-2"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}
        <button
          type="submit"
          className="rounded bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700"
        >
          로그인
        </button>
      </form>
      <p className="text-sm text-zinc-500">
        계정이 없나요?{" "}
        <Link href="/signup" className="underline">
          회원가입
        </Link>
      </p>
    </div>
  );
}
