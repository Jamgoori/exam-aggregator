import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { NICKNAME_MAX, NICKNAME_MIN } from "@gongmoa/core";
import { currentNickname, updateNickname } from "../src/lib/profile";
import { useAuth } from "../src/providers/auth-provider";
import { useColors } from "../src/theme/colors";

// 닉네임 설정/수정. 소셜 로그인 직후 닉네임이 없으면 여기로 보내지고(온보딩),
// 마이페이지에서 "닉네임 수정"으로도 들어온다.
export default function NicknameScreen() {
  const colors = useColors();
  const router = useRouter();
  const { session } = useAuth();
  const existing = currentNickname(session?.user.user_metadata);
  const [value, setValue] = useState(existing ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateNickname(value);
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: existing ? "닉네임 수정" : "닉네임 설정" }} />
      <View style={{ padding: 24, gap: 14 }}>
        <Text style={{ color: colors.textMuted }}>
          다른 사람에게 보이는 이름이에요 ({NICKNAME_MIN}~{NICKNAME_MAX}자).
        </Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder="닉네임"
          placeholderTextColor={colors.textMuted}
          maxLength={NICKNAME_MAX}
          autoFocus
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 16,
            color: colors.text,
          }}
        />
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}
        <Pressable
          onPress={save}
          disabled={saving || value.trim().length < NICKNAME_MIN}
          style={{
            backgroundColor:
              saving || value.trim().length < NICKNAME_MIN ? colors.border : colors.primary,
            borderRadius: 12,
            paddingVertical: 13,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {saving && <ActivityIndicator color={colors.primaryText} />}
          <Text style={{ color: colors.primaryText, fontWeight: "600" }}>저장</Text>
        </Pressable>
      </View>
    </View>
  );
}
