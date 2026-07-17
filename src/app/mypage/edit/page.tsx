import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updatePassword } from "@/app/actions";
import { NicknameField } from "@/components/nickname-field";
import { CbtViewModeField } from "@/components/cbt-view-mode-field";

export default async function EditAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent("/mypage/edit")}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const nickname =
    (user.user_metadata?.nickname as string | undefined) ??
    user.email?.split("@")[0] ??
    "회원";

  // 구글 로그인 등 OAuth로만 가입한 계정은 비밀번호 자체가 없으므로 변경 폼을 보여주지 않는다.
  const hasPassword = user.app_metadata?.provider === "email";
  // 계정에 명시적으로 잠긴 값이 없으면 사이트 기본값인 "문제별 풀기"를 보여준다
  // (CbtSolver의 시작 모드 결정 로직과 동일한 기본값).
  const defaultCbtViewMode =
    user.user_metadata?.default_cbt_view_mode === "full" ? "full" : "single";

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-8 px-4 py-12">
      <div>
        <Link href="/mypage" className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400">
          ← 마이페이지
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">내 정보 수정</h1>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p className="text-sm text-green-600 dark:text-green-400">{message}</p>}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">닉네임</h2>
        <NicknameField mode="edit" defaultValue={nickname} />
      </section>

      <section className="flex flex-col gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-700">
        <h2 className="text-lg font-semibold">CBT 시작 화면</h2>
        <CbtViewModeField defaultValue={defaultCbtViewMode} />
      </section>

      {hasPassword && (
        <section className="flex flex-col gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-700">
          <h2 className="text-lg font-semibold">비밀번호 변경</h2>
          <form action={updatePassword} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="currentPassword" className="text-sm text-zinc-600 dark:text-zinc-400">
                현재 비밀번호
              </label>
              <input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
                className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
              />
            </div>
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
                className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="newPasswordConfirm" className="text-sm text-zinc-600 dark:text-zinc-400">
                새 비밀번호 확인
              </label>
              <input
                id="newPasswordConfirm"
                name="newPasswordConfirm"
                type="password"
                minLength={8}
                required
                className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
              />
            </div>
            <button
              type="submit"
              className="mt-2 self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              변경
            </button>
          </form>
        </section>
      )}

      <div className="flex flex-col gap-1 border-t border-zinc-100 pt-6 dark:border-zinc-700">
        <span className="text-sm text-zinc-500 dark:text-zinc-500">이메일</span>
        <span className="text-sm text-zinc-700 dark:text-zinc-300">{user.email}</span>
      </div>
    </div>
  );
}
