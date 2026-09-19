import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NicknameField } from "@/components/nickname-field";
import { ProfileImageField } from "@/components/profile-image-field";
import { avatarUrl } from "@/lib/avatars";
import { CbtViewModeField } from "@/components/cbt-view-mode-field";
import { DeleteAccountButton } from "@/components/delete-account-button";
import { BlockedUsersSection } from "@/components/blocked-users-section";
import { fetchBlockedUsers } from "@/lib/blocks";

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

  // 계정에 명시적으로 잠긴 값이 없으면 사이트 기본값인 "문제별 풀기"를 보여준다
  // (CbtSolver의 시작 모드 결정 로직과 동일한 기본값).
  const defaultCbtViewMode =
    user.user_metadata?.default_cbt_view_mode === "full" ? "full" : "single";

  // 차단한 사용자 목록(RPC my_blocked_users — 닉네임은 함수가 profiles 에서 붙인다). 조회 실패는
  // 절 안에 문구로만 나타나고 페이지는 그대로 열린다(1라운드 SQL 미적용 상태에서도 내 정보 수정이
  // 막히면 안 된다).
  const blocked = await fetchBlockedUsers();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 pb-12 pt-6 sm:pt-8">
      <div>
        <Link href="/mypage" className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400">
          ← 마이페이지
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">내 정보 수정</h1>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {message && <p className="text-sm text-green-600 dark:text-green-400">{message}</p>}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">프로필 사진</h2>
        <ProfileImageField
          nickname={nickname}
          initialAvatarUrl={avatarUrl(user.user_metadata?.avatar_path as string | undefined)}
        />
      </section>

      <section className="flex flex-col gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-700">
        <h2 className="text-lg font-semibold">닉네임</h2>
        <NicknameField defaultValue={nickname} />
      </section>

      <section className="flex flex-col gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-700">
        <h2 className="text-lg font-semibold">CBT 시작 화면</h2>
        <CbtViewModeField defaultValue={defaultCbtViewMode} />
      </section>

      {/* 앱 /mypage/edit 의 "차단한 사용자" 절과 같은 자리(설계서 §12-2 #16 — 차단한 사용자의
          글·댓글은 어디에도 보이지 않으므로 해제할 자리가 여기밖에 없다). */}
      <section className="flex flex-col gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-700">
        <h2 className="text-lg font-semibold">차단한 사용자</h2>
        <BlockedUsersSection initialUsers={blocked.users} loadError={blocked.error} />
      </section>

      {/* 카카오는 이메일 제공 동의를 안 한 계정이면 email이 없을 수 있다. */}
      {user.email && (
        <div className="flex flex-col gap-1 border-t border-zinc-100 pt-6 dark:border-zinc-700">
          <span className="text-sm text-zinc-500 dark:text-zinc-500">이메일</span>
          <span className="text-sm text-zinc-700 dark:text-zinc-300">{user.email}</span>
        </div>
      )}

      <section className="flex flex-col gap-4 border-t border-zinc-100 pt-6 dark:border-zinc-700">
        <h2 className="text-lg font-semibold">회원 탈퇴</h2>
        <DeleteAccountButton />
      </section>
    </div>
  );
}
