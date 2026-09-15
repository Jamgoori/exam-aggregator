import { NICKNAME_MAX, NICKNAME_MIN } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { BackHandler, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { Button } from "../../src/components/button";
import { Input } from "../../src/components/input";
import { Screen } from "../../src/components/screen";
import { resolveNextPath } from "../../src/lib/next-path";
import { currentNickname, updateNickname } from "../../src/lib/profile";
import { useAuth } from "../../src/providers/auth-provider";

// 닉네임 온보딩(웹 onboarding/nickname/page.tsx 1:1, 설계서 §7.1). 소셜 로그인 직후
// user_metadata.nickname 이 비어 있으면 최초 1회 여기로 온다. 뒤로가기 차단(모달 gesture off +
// Android 백버튼 무시) — 닉네임 없이 앱을 돌아다니면 댓글·마이페이지가 깨진다.
export default function NicknameOnboardingScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  // 닉네임까지 정한 사람이 갈 곳이 없으면 소개 랜딩(/)이 아니라 문제지 목록으로(웹 규칙).
  // login.tsx 와 같이 앱 화이트리스트(resolveNextPath)를 지난 값에 그 규칙을 얹는다.
  const resolved = resolveNextPath(params.next);
  const next = resolved === "/" ? "/papers" : resolved;
  const { session, loading } = useAuth();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  // 비로그인이면 로그인으로(웹과 동일), 이미 닉네임이 있으면 건너뛴다.
  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace(
        `/login?next=${encodeURIComponent(`/onboarding/nickname?next=${encodeURIComponent(next)}`)}` as Href,
      );
      return;
    }
    if (currentNickname(session.user.user_metadata)) router.replace(next as Href);
  }, [loading, session, next]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await updateNickname(value);
      router.replace(next as Href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen footer={false} contentClassName="max-w-sm gap-6 py-24">
      <View>
        <AppText variant="2xl" weight="semibold">
          닉네임을 설정해주세요
        </AppText>
        <AppText variant="sm" className="mt-1 text-zinc-500" pretty>
          앞으로 댓글과 마이페이지에 표시될 닉네임이에요. 나중에 언제든 바꿀 수 있어요.
        </AppText>
      </View>

      <View className="gap-1">
        <AppText variant="sm" className="text-zinc-600 dark:text-zinc-400" nativeID="nickname-label">
          닉네임
        </AppText>
        <Input
          value={value}
          onChangeText={setValue}
          maxLength={NICKNAME_MAX}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          accessibilityLabelledBy="nickname-label"
          className="rounded"
        />
        <AppText variant="xs" className="mb-2 text-zinc-400 dark:text-zinc-500">
          {NICKNAME_MIN}~{NICKNAME_MAX}자로 입력해주세요.
        </AppText>
        {error && (
          <AppText variant="sm" className="text-red-600 dark:text-red-400" accessibilityRole="alert">
            {error}
          </AppText>
        )}
        <Button
          label="시작하기"
          pending={saving}
          disabled={value.trim().length < NICKNAME_MIN}
          onPress={() => void submit()}
          className="mt-2 rounded px-4 py-2"
          textClassName="font-normal text-base"
        />
      </View>
    </Screen>
  );
}
