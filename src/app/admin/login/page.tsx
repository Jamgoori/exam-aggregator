import { login } from "@/app/admin/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-2xl font-semibold">관리자 로그인</h1>
      <form action={login} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm text-zinc-600 dark:text-zinc-400">
            이메일
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
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
        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            로그인에 실패했습니다. 이메일/비밀번호를 확인해주세요.
          </p>
        )}
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          로그인
        </button>
      </form>
    </div>
  );
}
