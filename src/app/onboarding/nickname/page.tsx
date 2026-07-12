import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateNickname } from "@/app/actions";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { NICKNAME_MAX, NICKNAME_MIN } from "@/lib/nickname";

// 구글 로그인은 이메일/비밀번호 가입과 달리 닉네임을 받을 폼 자체가 없어서, 콜백에서
// user_metadata.nickname이 비어있으면 최초 1회 여기로 보내 닉네임을 받는다.
export default async function NicknameOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = sanitizeNextPath(rawNext);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/onboarding/nickname?next=${encodeURIComponent(next)}`)}`,
    );
  }

  // 이미 닉네임이 있으면(재로그인 등) 온보딩을 건너뛰고 원래 가려던 곳으로 보낸다.
  if (user.user_metadata?.nickname) {
    redirect(next);
  }

  const formPath = `/onboarding/nickname?next=${encodeURIComponent(next)}`;

  return (
    <div className="mx-auto flex max-w-sm flex-col gap-6 px-4 py-24">
      <div>
        <h1 className="text-2xl font-semibold">닉네임을 설정해주세요</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          앞으로 댓글과 마이페이지에 표시될 닉네임이에요. 나중에 언제든 바꿀 수 있어요.
        </p>
      </div>

      <form action={updateNickname} className="flex flex-col gap-1">
        <input type="hidden" name="formPath" value={formPath} />
        <input type="hidden" name="successPath" value={next} />
        <label htmlFor="nickname" className="text-sm text-zinc-600 dark:text-zinc-400">
          닉네임
        </label>
        <input
          id="nickname"
          name="nickname"
          required
          minLength={NICKNAME_MIN}
          maxLength={NICKNAME_MAX}
          autoFocus
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700"
        />
        <p className="mb-2 text-xs text-zinc-400 dark:text-zinc-500">
          {NICKNAME_MIN}~{NICKNAME_MAX}자로 입력해주세요.
        </p>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="submit"
          className="mt-2 rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          시작하기
        </button>
      </form>
    </div>
  );
}
