import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { confirmPasswordReset } from "@/app/actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 재설정 이메일의 링크를 타고 /auth/callback이 세션을 발급해줘야만 도착할 수 있는
  // 화면이라, 세션이 없으면 링크가 만료됐거나 직접 URL을 친 경우다.
  if (!user) {
    redirect(
      `/forgot-password?error=${encodeURIComponent("재설정 링크가 만료됐거나 잘못됐어요. 다시 요청해주세요.")}`,
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-2xl font-semibold">비밀번호 재설정</h1>

      <form action={confirmPasswordReset} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="newPassword" className="text-sm text-zinc-600 dark:text-zinc-400">
            새 비밀번호 (8자 이상)
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            minLength={8}
            required
            autoComplete="new-password"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="newPasswordConfirm"
            className="text-sm text-zinc-600 dark:text-zinc-400"
          >
            새 비밀번호 확인
          </label>
          <input
            id="newPasswordConfirm"
            name="newPasswordConfirm"
            type="password"
            minLength={8}
            required
            autoComplete="new-password"
            className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          변경하기
        </button>
      </form>
    </div>
  );
}
