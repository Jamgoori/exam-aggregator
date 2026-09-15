import { router, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { Avatar } from "../../src/components/avatar";
import { CbtViewModeField } from "../../src/components/mypage/cbt-view-mode-field";
import { DeleteAccountButton } from "../../src/components/mypage/delete-account-button";
import { NicknameField } from "../../src/components/mypage/nickname-field";
import { ReminderToggle } from "../../src/components/mypage/reminder-toggle";
import { LoginRequiredScreen, useRequireLogin } from "../../src/components/mypage/require-login";
import { Screen } from "../../src/components/screen";
import { currentCbtViewMode } from "../../src/lib/profile";
import { useUnresolvedBySubject } from "../../src/queries/wrong-notes";
import { useAuth } from "../../src/providers/auth-provider";

// `/mypage/edit`(설계서 §5 행, 웹 app/mypage/edit/page.tsx 1:1 + 현행 settings.tsx 통합 — §7.1
// 프로필/아바타 항목): 프로필 사진(읽기 전용 — 업로드는 Phase 4 EF avatar-upload) → 닉네임 →
// CBT 시작 화면 → 리마인더(앱 전용) → 이메일 → 회원 탈퇴. 로그아웃은 웹처럼 여기 없다(드로어).
export default function EditAccountScreen() {
  const { userId, loading } = useRequireLogin("/mypage/edit");
  if (loading) return <Screen contentClassName="gap-8" />;
  if (!userId) return <LoginRequiredScreen />;
  return <EditAccountBody />;
}

function EditAccountBody() {
  const { user, nickname, avatarUrl } = useAuth();
  const { total: unresolvedCount } = useUnresolvedBySubject();
  const meta = user?.user_metadata as Record<string, unknown> | undefined;

  return (
    <Screen contentClassName="gap-8">
      <View>
        <Pressable accessibilityRole="link" onPress={() => (router.canGoBack() ? router.back() : router.replace("/mypage" as Href))} hitSlop={6} className="self-start">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 마이페이지
          </AppText>
        </Pressable>
        <AppText variant="2xl" weight="semibold" className="mt-2">
          내 정보 수정
        </AppText>
      </View>

      <Section title="프로필 사진" first>
        <View className="flex-row items-center gap-4">
          <Avatar nickname={nickname} avatarUrl={avatarUrl} size="xl" />
          {/* 사진 선택·업로드(expo-image-picker + EF avatar-upload)는 Phase 4 — 지금은 보기만. */}
          <AppText variant="sm" className="min-w-0 flex-1 text-zinc-500 dark:text-zinc-500" pretty>
            프로필 사진 변경은 다음 업데이트에서 지원돼요.
          </AppText>
        </View>
      </Section>

      <Section title="닉네임">
        <NicknameField defaultValue={nickname} />
      </Section>

      <Section title="CBT 시작 화면">
        <CbtViewModeField defaultValue={currentCbtViewMode(meta)} />
      </Section>

      <Section title="알림">
        <ReminderToggle unresolvedCount={unresolvedCount} />
      </Section>

      {/* 카카오는 이메일 제공 동의를 안 한 계정이면 email 이 없을 수 있다. */}
      {user?.email && (
        <View className="gap-1 border-t border-zinc-100 pt-6 dark:border-zinc-700">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            이메일
          </AppText>
          <AppText variant="sm" className="text-zinc-700 dark:text-zinc-300" selectable>
            {user.email}
          </AppText>
        </View>
      )}

      <Section title="회원 탈퇴">
        <DeleteAccountButton />
      </Section>
    </Screen>
  );
}

function Section({ title, first = false, children }: { title: string; first?: boolean; children: React.ReactNode }) {
  return (
    <View className={["gap-4", first ? "" : "border-t border-zinc-100 pt-6 dark:border-zinc-700"].join(" ")}>
      <AppText variant="lg" weight="semibold">
        {title}
      </AppText>
      {children}
    </View>
  );
}
